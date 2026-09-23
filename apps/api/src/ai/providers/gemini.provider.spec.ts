import Anthropic from '@anthropic-ai/sdk';
import {
  toGeminiContents,
  callGemini,
  thinkingConfigFor,
  outputTokenCeiling,
  usesThinkingLevel,
} from './gemini.provider';

/**
 * Four features speak Anthropic's message shape. Rather than rewrite them all
 * to switch provider, this translates on the way out — so what it must never
 * do is quietly drop the part of the message that carries the meaning. A
 * receipt photo silently lost here would look exactly like a model that read
 * nothing, and we would go hunting in the wrong place.
 */
describe('Anthropic messages, spoken to Gemini', () => {
  const image = (data: string, media: 'image/jpeg' | 'image/png' = 'image/jpeg'): Anthropic.MessageParam => ({
    role: 'user',
    content: [{ type: 'image', source: { type: 'base64', media_type: media, data } }],
  });

  it('carries a plain string message through', () => {
    expect(toGeminiContents([{ role: 'user', content: 'how much did we spend' }]))
      .toEqual([{ role: 'user', parts: [{ text: 'how much did we spend' }] }]);
  });

  it('calls the assistant "model", because Gemini does', () => {
    const out = toGeminiContents([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    expect(out.map((c) => c.role)).toEqual(['user', 'model']);
  });

  it('turns a photo into inline data, keeping its type', () => {
    expect(toGeminiContents([image('AAAA', 'image/png')])).toEqual([
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
    ]);
  });

  it('keeps every strip of a long receipt, in order, with the instruction last', () => {
    // This is the shape the receipt reader sends: N images then the text.
    const msg: Anthropic.MessageParam = {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'top' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'middle' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'bottom' } },
        { type: 'text', text: 'These 3 images are ONE receipt.' },
      ],
    };
    const parts = toGeminiContents([msg])[0].parts;
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3).map((p) => (p as any).inlineData.data)).toEqual(['top', 'middle', 'bottom']);
    expect((parts[3] as any).text).toContain('ONE receipt');
  });

  it('drops a block it does not understand rather than inventing one', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'keep me' },
        { type: 'tool_result', tool_use_id: 't1', content: 'ignore me' },
      ],
    } as unknown as Anthropic.MessageParam;
    expect(toGeminiContents([msg])[0].parts).toEqual([{ text: 'keep me' }]);
  });

  it('never sends a message with no parts at all — the API rejects those', () => {
    const msg = { role: 'user', content: [] } as unknown as Anthropic.MessageParam;
    expect(toGeminiContents([msg])[0].parts).toEqual([{ text: '' }]);
  });
});

describe('callGemini — what comes back', () => {
  function client(response: unknown) {
    const generateContent = jest.fn().mockResolvedValue(response);
    return { client: { models: { generateContent } } as any, generateContent };
  }

  it('asks with the system prompt and token ceiling, and reports the counts', async () => {
    const { client: c, generateContent } = client({
      text: '  {"lines":[]}  ',
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, cachedContentTokenCount: 900 },
    });

    const out = await callGemini(c, {
      model: 'gemini-flash-latest',
      messages: [{ role: 'user', content: 'read it' }],
      systemPrompt: 'you read receipts',
      maxTokens: 2500,
    });

    const args = generateContent.mock.calls[0][0];
    expect(args.model).toBe('gemini-flash-latest');
    expect(args.config.systemInstruction).toBe('you read receipts');
    expect(args.config.maxOutputTokens).toBe(2500);
    expect(out).toEqual({
      text: '{"lines":[]}',            // trimmed, like the Anthropic path
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 900,               // reported, but NOT added to the cost
    });
  });

  it('asks the model on duty for as little thinking as it will accept', async () => {
    const { client: c, generateContent } = client({ text: 'x' });
    await callGemini(c, { model: 'gemini-3.8-flash', messages: [] });
    expect(generateContent.mock.calls[0][0].config.thinkingConfig)
      .toEqual({ thinkingLevel: 'LOW', includeThoughts: false });
  });

  it('treats an empty answer as a failed call, and says why', async () => {
    const { client: c } = client({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(callGemini(c, { model: 'gemini-2.5-flash', messages: [], maxTokens: 400 }))
      .rejects.toThrow(/no usable text.*MAX_TOKENS.*400/s);
  });

  it('reports the ceiling it actually sent, not the one it was asked for', async () => {
    const { client: c } = client({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
    // A thinking model's 400 was raised to the floor; saying "400" would send
    // whoever reads the log looking for a setting that is not in force.
    await expect(callGemini(c, { model: 'gemini-3.8-flash', messages: [], maxTokens: 400 }))
      .rejects.toThrow(/maxOutputTokens=2048/);
  });

  it('counts thinking tokens as output, because Google bills them that way', async () => {
    const { client: c } = client({
      text: 'ok',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 500 },
    });
    const out = await callGemini(c, { model: 'm', messages: [] });
    // 20 visible + 500 thought. Leaving the thoughts out would under-report
    // the spend by 25x on this call, and the budget cap watches that number.
    expect(out.outputTokens).toBe(520);
  });

  it('leaves the system instruction out entirely when there is none', async () => {
    const { client: c, generateContent } = client({ text: 'x' });
    await callGemini(c, { model: 'gemini-3.8-flash', messages: [] });
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty('systemInstruction');
  });
});

/**
 * The two generations of Flash disagree about thinking, and getting it wrong
 * is not a degraded answer — it is a rejected request.
 *
 *   Gemini 2.5 takes `thinkingBudget`, a token count, and 0 means OFF.
 *   Gemini 3 takes `thinkingLevel` and cannot be switched off at all. LOW is
 *   the floor on 3.x Flash: "MINIMAL" is in the SDK but 3.8 Flash rejects it
 *   outright, and sending both fields together is an error too.
 *
 * So the shape follows the model id. This is pinned because the failure is
 * invisible in review and total in production: every AI button, 503, at once.
 */
describe('Thinking, in the shape the model on duty accepts', () => {
  it.each([
    ['gemini-3.8-flash',    true],
    ['gemini-3.5-flash',    true],
    ['gemini-3-flash',      true],
    ['gemini-2.5-flash',    false],
    ['gemini-2.0-flash',    false],
    ['gemini-flash-latest', true],   // unreadable id — assume the new generation
  ])('%s', (model, expectsLevel) => {
    expect(usesThinkingLevel(model)).toBe(expectsLevel);
  });

  it('sends thinkingLevel to Gemini 3, and never a budget alongside it', () => {
    const config = thinkingConfigFor('gemini-3.8-flash');
    expect(config).toEqual({ thinkingLevel: 'LOW', includeThoughts: false });
    expect(config).not.toHaveProperty('thinkingBudget');
  });

  it('still sends a budget of zero to Gemini 2.5, where thinking CAN be turned off', () => {
    const config = thinkingConfigFor('gemini-2.5-flash');
    expect(config).toEqual({ thinkingBudget: 0, includeThoughts: false });
    expect(config).not.toHaveProperty('thinkingLevel');
  });
});

/**
 * Gemini 3 cannot stop thinking, and maxOutputTokens is a hard cutoff that
 * counts thought tokens. The receipt route asks for 400 — which a thinking
 * model would spend entirely on thought, returning an empty string that reads
 * exactly like an unreadable photo. The cashier would then be told to re-shoot
 * a picture that was perfectly good.
 *
 * Raising a CEILING costs nothing: Google bills tokens produced, not tokens
 * allowed. So this is headroom, not spend.
 */
describe('The output allowance leaves room for the thinking we cannot turn off', () => {
  it('floors a thinking model at 2048, whatever the caller asked for', () => {
    expect(outputTokenCeiling('gemini-3.8-flash', 400)).toBe(2048);
  });

  it('never lowers what the caller asked for', () => {
    expect(outputTokenCeiling('gemini-3.8-flash', 2500)).toBe(2500);
  });

  it('leaves a non-thinking model exactly as asked', () => {
    expect(outputTokenCeiling('gemini-2.5-flash', 400)).toBe(400);
  });

  it('falls back to the same default as the Anthropic path when nothing is asked', () => {
    expect(outputTokenCeiling('gemini-2.5-flash', undefined)).toBe(1024);
  });
});

/**
 * Emptying a box in the Railway dashboard is how anybody says "go back to the
 * default". It does not unset the variable — it leaves an empty string — and
 * an empty string is not a missing thinkingLevel to Vertex, it is an invalid
 * enum. The request is rejected before a token is generated, so the whole app
 * answers 503 and the cause is a field somebody cleared on purpose.
 *
 * The settings are read at import, so each case loads the module fresh.
 */
describe('A thinking level that was cleared, not chosen', () => {
  const OLD_ENV = process.env;

  afterEach(() => { process.env = OLD_ENV; jest.resetModules(); });

  /** The level a fresh copy of the module would send for Gemini 3. */
  function levelFor(value: string | undefined): string | undefined {
    jest.resetModules();
    process.env = { ...OLD_ENV, GEMINI_THINKING_LEVEL: value };
    const fresh = require('./gemini.provider') as typeof import('./gemini.provider');
    return (fresh.thinkingConfigFor('gemini-3.8-flash') as { thinkingLevel?: string }).thinkingLevel;
  }

  it.each([
    ['unset',             undefined, 'LOW'],
    ['cleared',           '',        'LOW'],
    ['cleared to spaces', '   ',     'LOW'],
    ['chosen',            'medium',  'MEDIUM'],
    ['chosen, padded',    ' high ',  'HIGH'],
  ])('%s -> %s', (_name, value, expected) => {
    expect(levelFor(value)).toBe(expected);
  });

  it('never sends an empty level, whatever the variable holds', () => {
    for (const value of [undefined, '', ' ', '\t', '\n']) {
      expect(levelFor(value)).toBeTruthy();
    }
  });
});
