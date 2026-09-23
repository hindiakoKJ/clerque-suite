/**
 * The Gemini client must be a VERTEX client, and this test exists to make
 * swapping it for an AI Studio key a red build.
 *
 * It is not a style preference. The free AI Studio tier trains on what you
 * send it, and what Clerque sends it is a photograph of a paying client's
 * receipt — their suppliers, their prices, their volumes. Vertex does not.
 * Vertex is also the only path a Google Cloud credit can pay for. Everything
 * else about the two is close enough that the difference would go unnoticed
 * in review, which is exactly why it is pinned here instead.
 */
const constructed: unknown[] = [];

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation((options: unknown) => {
    constructed.push(options);
    return { models: { generateContent: jest.fn() } };
  }),
}));

/*
  Obviously-fake key material, in the shape Google writes it. Reused by the
  credential tests below; nothing here has ever been a real key.
*/
const FAKE_PEM_BODY = 'MIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA0FAKE';
const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${FAKE_PEM_BODY}\n-----END PRIVATE KEY-----\n`;
const FAKE_EMAIL = 'clerque-vertex@clerque-ai.iam.gserviceaccount.com';

function keyFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type:         'service_account',
    project_id:   'clerque-ai',
    private_key:  FAKE_PEM,
    client_email: FAKE_EMAIL,
    ...overrides,
  });
}

describe('The Gemini client is built for Vertex', () => {
  const OLD_ENV = process.env;
  let logged: string[] = [];

  beforeEach(() => { constructed.length = 0; logged = []; jest.resetModules(); });
  afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

  function build(env: Record<string, string | undefined>) {
    process.env = {
      ...OLD_ENV,
      AI_FEATURES_ENABLED: 'true',
      // Pinned off by default so a developer's own shell cannot change what
      // these cases prove.
      GOOGLE_CREDENTIALS_JSON: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      ...env,
    };
    /*
      Required from the SAME registry the service is about to use: after
      resetModules, the spec file's own import of @nestjs/common is a
      different copy, and a spy on it would never fire.
    */
    const { Logger } = require('@nestjs/common') as typeof import('@nestjs/common');
    for (const level of ['warn', 'error', 'log'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }

    const mod = require('./ai.service') as typeof import('./ai.service');
    new mod.AiService({} as never);
    return constructed;
  }

  it('turns vertexai on and passes the project and region', () => {
    const [opts] = build({ GOOGLE_CLOUD_PROJECT: 'carolina-prod', GOOGLE_CLOUD_LOCATION: 'asia-southeast1' });
    expect(opts).toEqual({ vertexai: true, project: 'carolina-prod', location: 'asia-southeast1' });
  });

  it('never carries an apiKey — that is the AI Studio path, and it trains on the data', () => {
    const [opts] = build({ GOOGLE_CLOUD_PROJECT: 'p', GEMINI_API_KEY: 'a-studio-key' });
    expect(opts).not.toHaveProperty('apiKey');
    expect((opts as { vertexai: boolean }).vertexai).toBe(true);
  });

  it('defaults the region rather than leaving it undefined', () => {
    const [opts] = build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CLOUD_LOCATION: undefined });
    expect((opts as { location: string }).location).toBe('us-central1');
  });

  it('builds no client at all without a project, instead of guessing one', () => {
    expect(build({ GOOGLE_CLOUD_PROJECT: undefined })).toEqual([]);
  });
});

/**
 * Credentials, from a variable rather than a file.
 *
 * This is the part that was missing and the reason Vertex could not work on
 * Railway at all: Google's libraries look for a JSON key FILE, or for a
 * metadata server, and Railway offers neither — you cannot upload a file, and
 * there is nothing to ask. Handed to the SDK as googleAuthOptions, the key
 * file's contents do the same job from an environment variable.
 */
describe('Vertex signs in with a key from the environment', () => {
  const OLD_ENV = process.env;
  let logged: string[] = [];

  beforeEach(() => { constructed.length = 0; logged = []; jest.resetModules(); });
  afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

  function build(env: Record<string, string | undefined>) {
    process.env = {
      ...OLD_ENV,
      AI_FEATURES_ENABLED: 'true',
      AI_PROVIDER: 'gemini',
      GOOGLE_CREDENTIALS_JSON: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      ...env,
    };
    const { Logger } = require('@nestjs/common') as typeof import('@nestjs/common');
    for (const level of ['warn', 'error', 'log'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    const mod = require('./ai.service') as typeof import('./ai.service');
    new mod.AiService({} as never);
    return constructed[0] as Record<string, any> | undefined;
  }

  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

  it('hands the key to the SDK as googleAuthOptions.credentials', () => {
    const opts = build({ GOOGLE_CLOUD_PROJECT: 'clerque-ai', GOOGLE_CREDENTIALS_JSON: keyFile() });
    expect(opts!.googleAuthOptions).toEqual({
      credentials: { client_email: FAKE_EMAIL, private_key: FAKE_PEM, project_id: 'clerque-ai' },
      projectId:   'clerque-ai',
    });
    expect(opts!.vertexai).toBe(true);
    expect(opts).not.toHaveProperty('apiKey');
  });

  it('accepts the same key base64-encoded, which is what a dashboard field survives', () => {
    const plain = build({ GOOGLE_CLOUD_PROJECT: 'clerque-ai', GOOGLE_CREDENTIALS_JSON: keyFile() });
    constructed.length = 0;
    const encoded = build({ GOOGLE_CLOUD_PROJECT: 'clerque-ai', GOOGLE_CREDENTIALS_JSON: b64(keyFile()) });
    expect(encoded).toEqual(plain);
  });

  it('un-escapes the private key, so Google does not answer with a signature error', () => {
    const escaped = keyFile({ private_key: FAKE_PEM.replace(/\n/g, '\\n') });
    const opts = build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: escaped });
    expect(opts!.googleAuthOptions.credentials.private_key).toBe(FAKE_PEM);
  });

  // One less variable to set, and one less way for the two to disagree.
  it('takes the project from the key file when GOOGLE_CLOUD_PROJECT is unset', () => {
    const opts = build({ GOOGLE_CLOUD_PROJECT: undefined, GOOGLE_CREDENTIALS_JSON: keyFile() });
    expect(opts!.project).toBe('clerque-ai');
    expect(opts!.googleAuthOptions.projectId).toBe('clerque-ai');
  });

  it('lets GOOGLE_CLOUD_PROJECT win when it is set to something else', () => {
    const opts = build({ GOOGLE_CLOUD_PROJECT: 'another-project', GOOGLE_CREDENTIALS_JSON: keyFile() });
    expect(opts!.project).toBe('another-project');
    expect(opts!.googleAuthOptions.projectId).toBe('another-project');
  });

  it('changes nothing when the variable is absent — the file path still works locally', () => {
    const opts = build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: undefined });
    expect(opts).toEqual({ vertexai: true, project: 'p', location: 'us-central1' });
  });

  /*
    Fail closed. A key that cannot be parsed is not "try the file instead" —
    on Railway there is no file, so building the client anyway would trade our
    plain message for an obscure one from Google, raised at the till.
  */
  it('builds no client when the key is set but unreadable, even with a project', () => {
    expect(build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: 'not-a-key' })).toBeUndefined();
  });

  it('says what is wrong, names the variable, and does not crash the API', () => {
    build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: '{"client_email":"a@b.c"}' });
    expect(logged.join('\n')).toContain('GOOGLE_CREDENTIALS_JSON');
    expect(logged.join('\n')).toContain('private_key');
    expect(logged.join('\n')).toMatch(/503/);   // and the caller is told plainly
  });

  /*
    The honest half of the provider switch. A project with no credentials
    builds a client that LOOKS configured and fails on the first call, because
    there is nothing to sign with. On Railway that is always the case, so it
    is said at boot rather than discovered over a receipt.
  */
  it('warns at boot when there is a project but nothing to sign requests with', () => {
    build({ GOOGLE_CLOUD_PROJECT: 'p' });
    expect(logged.join('\n')).toMatch(/GOOGLE_CREDENTIALS_JSON/);
    expect(logged.join('\n')).toMatch(/metadata server/i);
  });

  it('is quiet once the key is there', () => {
    build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: keyFile() });
    expect(logged.join('\n')).not.toMatch(/503/);
  });

  it('stays quiet for a machine that does have a credentials file', () => {
    build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_APPLICATION_CREDENTIALS: '/home/kj/key.json' });
    expect(logged.join('\n')).not.toMatch(/metadata server/i);
  });

  /**
   * Railway keeps logs, logs get pasted into chat, and a service-account
   * private key is a standing grant of Vertex on the whole project. Not one
   * character of it may be written out — on the happy path or on any of the
   * failures.
   */
  it.each([
    ['a good key',        keyFile()],
    ['an escaped key',    keyFile({ private_key: FAKE_PEM.replace(/\n/g, '\\n') })],
    ['a base64 key',      Buffer.from(keyFile(), 'utf8').toString('base64')],
    ['a key with no PEM', keyFile({ private_key: FAKE_PEM_BODY })],
    ['a truncated file',  keyFile().slice(0, 40)],
    ['plain junk',        'not-a-key'],
  ])('never writes %s to the log', (_label, raw) => {
    build({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: raw });
    const all = logged.join('\n');
    for (const secret of [FAKE_PEM_BODY, FAKE_PEM, FAKE_EMAIL, raw.slice(0, 24)]) {
      expect(all).not.toContain(secret);
    }
  });
});
