/**
 * Which provider does the work, and what it gets asked for.
 *
 * The trap this pins: the drafter and the guide name their model by constant —
 * both ask for Opus. Handing "claude-opus-4-5" to Vertex is a 404 from Google
 * and a confusing hour for whoever reads the log, so a Claude id has to be
 * understood as "the strong model, whoever is serving today" and swapped for
 * Flash. The reverse matters too: a Gemini id must never reach Anthropic.
 *
 * The provider is read from env at import, so each case loads the module fresh.
 */
describe('AiService — who does the work', () => {
  const OLD_ENV = process.env;

  afterEach(() => { process.env = OLD_ENV; jest.resetModules(); jest.restoreAllMocks(); });

  function load(env: Record<string, string | undefined>) {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      AI_FEATURES_ENABLED: 'true',
      ANTHROPIC_API_KEY:   'test-key',
      GOOGLE_CLOUD_PROJECT: 'test-project',
      // Pinned off so a developer's own shell cannot change what these prove.
      GOOGLE_CREDENTIALS_JSON: undefined,
      GEMINI_MODEL:            undefined,
      ...env,
    };
    /*
      Quietened on purpose. These cases inject their own clients, so the
      constructor's "no credentials" warning is correct and irrelevant here —
      and printed 15 times it buries a real failure. The warning itself is
      proved in the end-to-end matrix at the bottom of this file.
    */
    const { Logger } = require('@nestjs/common') as typeof import('@nestjs/common');
    for (const level of ['warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }

    const mod = require('./ai.service') as typeof import('./ai.service');

    const usage: any[] = [];
    const prisma: any = {
      aiUsage: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }),
        create:    jest.fn().mockImplementation(({ data }: any) => { usage.push(data); return Promise.resolve({}); }),
      },
    };
    const svc: any = new mod.AiService(prisma);

    // Stand in for the two real clients. Both record what they were asked for.
    const gemini = { models: { generateContent: jest.fn().mockResolvedValue({ text: 'from gemini', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) } };
    const anthropic = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'from claude' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }) } };
    svc.gemini = gemini;
    svc.client = anthropic;

    return { mod, svc, gemini, anthropic, usage };
  }

  const ask = (svc: any, extra: Record<string, unknown> = {}) =>
    svc.call({ tenantId: 't1', action: 'journal_drafter', messages: [{ role: 'user', content: 'hi' }], ...extra });

  it('sends Flash to Vertex even when the caller asked for Opus by name', async () => {
    const { mod, svc, gemini, anthropic } = load({ AI_PROVIDER: 'gemini' });
    await expect(ask(svc, { model: mod.MODEL_OPUS })).resolves.toBe('from gemini');

    expect(gemini.models.generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash');
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('keeps a Gemini model the caller named on purpose', async () => {
    const { svc, gemini } = load({ AI_PROVIDER: 'gemini' });
    await ask(svc, { model: 'gemini-2.5-pro' });
    expect(gemini.models.generateContent.mock.calls[0][0].model).toBe('gemini-2.5-pro');
  });

  /*
    The escape hatch for the day Google retires 3.8 Flash. The default is a
    concrete version rather than a "-latest" alias — Vertex does not resolve
    those — so this variable is how the number gets updated without a deploy.
  */
  it('honours GEMINI_MODEL when one is configured', async () => {
    const { svc, gemini } = load({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-4.0-flash' });
    await ask(svc);
    expect(gemini.models.generateContent.mock.calls[0][0].model).toBe('gemini-4.0-flash');
  });

  /*
    A newer Flash set through GEMINI_MODEL is priced as Gemini, not as Sonnet.

    The pricing table is keyed by model id, and an unlisted id used to drop
    through to DEFAULT_MODEL — Claude Sonnet, at 2x the input and 2x the
    output of what was actually spent. The dashboard would have read high and
    the monthly cap would have fired at half the real usage.
  */
  it('prices a model the table has never heard of at the Gemini rate', async () => {
    const { svc, usage } = load({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-4.0-flash' });
    await ask(svc);
    expect(usage[0].costUsd).toBeCloseTo((10 / 1e6) * 1.5 + (5 / 1e6) * 7.5, 12);
  });

  it('still uses Claude, with the Claude model, when switched back', async () => {
    const { mod, svc, gemini, anthropic } = load({ AI_PROVIDER: 'anthropic' });
    await expect(ask(svc, { model: mod.MODEL_OPUS })).resolves.toBe('from claude');

    expect(anthropic.messages.create.mock.calls[0][0].model).toBe(mod.MODEL_OPUS);
    expect(gemini.models.generateContent).not.toHaveBeenCalled();
  });

  it('lets one call cross over, so the same receipt can be put through both', async () => {
    const { svc, gemini, anthropic } = load({ AI_PROVIDER: 'gemini' });
    await expect(ask(svc, { provider: 'anthropic' })).resolves.toBe('from claude');
    expect(gemini.models.generateContent).not.toHaveBeenCalled();
    expect(anthropic.messages.create).toHaveBeenCalled();
  });

  it('records the provider that actually did the work, not a hardcoded name', async () => {
    const { svc, usage } = load({ AI_PROVIDER: 'gemini' });
    await ask(svc);
    await ask(svc, { provider: 'anthropic' });
    expect(usage.map((u) => u.provider)).toEqual(['gemini', 'anthropic']);
    expect(usage[0].model).toBe('gemini-3.8-flash');
  });

  it('costs a Gemini call at the Gemini rate, not at Sonnet\'s', async () => {
    const { svc, usage } = load({ AI_PROVIDER: 'gemini', GEMINI_PRICE_IN: '1.5', GEMINI_PRICE_OUT: '7.5' });
    await ask(svc);
    // 10 input + 5 output tokens at 1.50 / 7.50 per 1M.
    expect(usage[0].costUsd).toBeCloseTo((10 / 1e6) * 1.5 + (5 / 1e6) * 7.5, 12);
  });

  /*
    A blank price is "not set", never zero.

    `??` does not catch the empty string and Number('') is 0 -- and
    .env.example ships GEMINI_PRICE_IN="", while clearing a Railway variable
    leaves an empty string behind. Priced at zero, every call costs nothing,
    the monthly budget cap can never fire, and the cost dashboard reads $0
    while real money is being spent.
  */
  it('falls back to the list price when the price env is blank or nonsense', async () => {
    for (const bad of ['', '   ', 'free', '1,5', '0', '-2']) {
      const { svc, usage } = load({ AI_PROVIDER: 'gemini', GEMINI_PRICE_IN: bad, GEMINI_PRICE_OUT: bad });
      await ask(svc);
      expect(usage[0].costUsd).toBeCloseTo((10 / 1e6) * 1.5 + (5 / 1e6) * 7.5, 12);
      expect(usage[0].costUsd).toBeGreaterThan(0);
    }
  });

  it('with AI_PROVIDER unset, uses Claude when only an Anthropic key is set', () => {
    const { mod } = load({ AI_PROVIDER: undefined, GOOGLE_CLOUD_PROJECT: undefined, ANTHROPIC_API_KEY: 'k' });
    expect(mod.AI_PROVIDER).toBe('anthropic');
  });

  it('with AI_PROVIDER unset and a Google project set, stays on Gemini', () => {
    const { mod } = load({ AI_PROVIDER: undefined });
    expect(mod.AI_PROVIDER).toBe('gemini');
  });

  it('refuses when the provider on duty is the one that is not configured', async () => {
    const { svc } = load({ AI_PROVIDER: 'gemini' });
    svc.gemini = null;
    // Matched on the message, not the class: resetModules gives each case its
    // own copy of @nestjs/common, so the two ServiceUnavailableException
    // constructors are different objects with the same name.
    await expect(ask(svc)).rejects.toThrow(/not configured/i);
  });
});

/**
 * The switch, told honestly.
 *
 * Every row here is a state a Railway variables page can actually be in, and
 * the rule is the same for all of them: either the provider on duty is fully
 * configured and works, or it is not and the caller gets one plain sentence.
 * What must never happen is the middle — a client that looks configured, is
 * missing the one thing it needs, and only says so at the till.
 *
 * These build the REAL service with no clients injected, so what is being
 * checked is the constructor's own decision.
 */
describe('AiService — the provider switch, end to end', () => {
  const OLD_ENV = process.env;

  const FAKE_PEM = '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG0FAKE\n-----END PRIVATE KEY-----\n';
  const KEY_FILE = JSON.stringify({
    type:         'service_account',
    project_id:   'clerque-ai',
    private_key:  FAKE_PEM,
    client_email: 'clerque-vertex@clerque-ai.iam.gserviceaccount.com',
  });

  afterEach(() => { process.env = OLD_ENV; jest.resetModules(); });

  function boot(env: Record<string, string | undefined>) {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      AI_FEATURES_ENABLED:            'true',
      ANTHROPIC_API_KEY:              undefined,
      AI_PROVIDER:                    undefined,
      GOOGLE_CLOUD_PROJECT:           undefined,
      GOOGLE_CREDENTIALS_JSON:        undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      ...env,
    };
    const { Logger } = require('@nestjs/common') as typeof import('@nestjs/common');
    const warnings: string[] = [];
    const notices:  string[] = [];
    for (const level of ['warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      });
    }
    jest.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      notices.push(args.map(String).join(' '));
    });

    const mod = require('./ai.service') as typeof import('./ai.service');
    const prisma: any = {
      aiUsage: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }),
        create:    jest.fn().mockResolvedValue({}),
      },
    };
    const svc: any = new mod.AiService(prisma);
    return {
      svc,
      warnings: warnings.join('\n'),
      notices:  notices.join('\n'),
      provider: mod.AI_PROVIDER,
    };
  }

  const ask = (svc: any) =>
    svc.call({ tenantId: 't1', action: 'receipt_ocr', messages: [{ role: 'user', content: 'hi' }] });

  it('gemini, with a project and a key: configured', () => {
    const { svc, warnings } = boot({
      AI_PROVIDER: 'gemini',
      GOOGLE_CLOUD_PROJECT: 'clerque-ai',
      GOOGLE_CREDENTIALS_JSON: KEY_FILE,
    });
    expect(svc.gemini).not.toBeNull();
    expect(warnings).toBe('');
  });

  it('gemini, key only: configured, because the key names its own project', () => {
    const { svc, warnings } = boot({ AI_PROVIDER: 'gemini', GOOGLE_CREDENTIALS_JSON: KEY_FILE });
    expect(svc.gemini).not.toBeNull();
    expect(warnings).toBe('');
  });

  it('gemini, project only: warns that there is nothing to sign requests with', () => {
    const { warnings } = boot({ AI_PROVIDER: 'gemini', GOOGLE_CLOUD_PROJECT: 'clerque-ai' });
    expect(warnings).toMatch(/GOOGLE_CREDENTIALS_JSON/);
    expect(warnings).toMatch(/metadata server/i);
  });

  it('gemini, nothing set: no client, and the warning names what is missing', async () => {
    const { svc, warnings } = boot({ AI_PROVIDER: 'gemini' });
    expect(svc.gemini).toBeNull();
    expect(warnings).toMatch(/GOOGLE_CLOUD_PROJECT/);
    await expect(ask(svc)).rejects.toThrow(/not configured/i);
  });

  it('gemini, key unreadable: no client, one plain line, and no stack trace', async () => {
    const { svc, warnings } = boot({
      AI_PROVIDER: 'gemini',
      GOOGLE_CLOUD_PROJECT: 'clerque-ai',
      GOOGLE_CREDENTIALS_JSON: 'pasted-the-wrong-thing',
    });
    expect(svc.gemini).toBeNull();
    expect(warnings).toMatch(/GOOGLE_CREDENTIALS_JSON/);
    expect(warnings).not.toMatch(/\bat \w+.*\(/);     // no stack frames
    await expect(ask(svc)).rejects.toThrow(/not configured/i);
  });

  it('anthropic, with a key: configured, and the Google variables are irrelevant', () => {
    const { svc, warnings } = boot({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(svc.client).not.toBeNull();
    expect(warnings).toBe('');
  });

  it('anthropic, no key: no client, and the warning names the variable', async () => {
    const { svc, warnings } = boot({ AI_PROVIDER: 'anthropic' });
    expect(svc.client).toBeNull();
    expect(warnings).toMatch(/ANTHROPIC_API_KEY/);
    await expect(ask(svc)).rejects.toThrow(/not configured/i);
  });

  // With AI_PROVIDER unset, follow whichever key is actually there — a server
  // with only an Anthropic key would otherwise pick Gemini and 503 everything.
  it.each([
    ['nothing at all',        {},                                                         'gemini'],
    ['an Anthropic key only', { ANTHROPIC_API_KEY: 'sk-ant-test' },                       'anthropic'],
    ['a Google project only', { GOOGLE_CLOUD_PROJECT: 'clerque-ai' },                     'gemini'],
    ['both',                  { ANTHROPIC_API_KEY: 'k', GOOGLE_CLOUD_PROJECT: 'p' },      'gemini'],
  ])('AI_PROVIDER unset with %s picks %s', (_label, env, expected) => {
    expect(boot(env as Record<string, string>).provider).toBe(expected);
  });

  /*
    The master switch outranks the whole matrix. A fully configured Gemini
    still spends nothing while AI_FEATURES_ENABLED is anything but "true" —
    this is the gate that actually prevents spend, checked before the client.
  */
  it('spends nothing while the master switch is off, however well configured', async () => {
    const { svc } = boot({
      AI_FEATURES_ENABLED: 'false',
      AI_PROVIDER: 'gemini',
      GOOGLE_CREDENTIALS_JSON: KEY_FILE,
    });
    await expect(ask(svc)).rejects.toThrow(/switched off/i);
  });

  /*
    And says so at boot rather than warning about 503s. Every deployment has
    AI off today; a log line reading "AI features will return 503" on a server
    where AI was deliberately turned off is a false alarm someone would go and
    investigate.
  */
  it('does not cry wolf at boot when AI is deliberately off', () => {
    const { warnings, notices } = boot({ AI_FEATURES_ENABLED: 'false' });
    expect(warnings).toBe('');
    expect(notices).toMatch(/switched off/i);
    expect(notices).toMatch(/nothing is spent/i);
  });
});
