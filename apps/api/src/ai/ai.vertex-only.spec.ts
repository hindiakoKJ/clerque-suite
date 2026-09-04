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

describe('The Gemini client is built for Vertex', () => {
  const OLD_ENV = process.env;

  beforeEach(() => { constructed.length = 0; jest.resetModules(); });
  afterEach(() => { process.env = OLD_ENV; });

  function build(env: Record<string, string | undefined>) {
    process.env = { ...OLD_ENV, AI_FEATURES_ENABLED: 'true', ...env };
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
