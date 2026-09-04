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

  afterEach(() => { process.env = OLD_ENV; jest.resetModules(); });

  function load(env: Record<string, string | undefined>) {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      AI_FEATURES_ENABLED: 'true',
      ANTHROPIC_API_KEY:   'test-key',
      GOOGLE_CLOUD_PROJECT: 'test-project',
      ...env,
    };
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

    expect(gemini.models.generateContent.mock.calls[0][0].model).toBe('gemini-flash-latest');
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('keeps a Gemini model the caller named on purpose', async () => {
    const { svc, gemini } = load({ AI_PROVIDER: 'gemini' });
    await ask(svc, { model: 'gemini-2.5-pro' });
    expect(gemini.models.generateContent.mock.calls[0][0].model).toBe('gemini-2.5-pro');
  });

  it('honours GEMINI_MODEL when one is configured', async () => {
    const { svc, gemini } = load({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash' });
    await ask(svc);
    expect(gemini.models.generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash');
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
    expect(usage[0].model).toBe('gemini-flash-latest');
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

  it('refuses when the provider on duty is the one that is not configured', async () => {
    const { svc } = load({ AI_PROVIDER: 'gemini' });
    svc.gemini = null;
    // Matched on the message, not the class: resetModules gives each case its
    // own copy of @nestjs/common, so the two ServiceUnavailableException
    // constructors are different objects with the same name.
    await expect(ask(svc)).rejects.toThrow(/not configured/i);
  });
});
