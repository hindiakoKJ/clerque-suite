import Anthropic from '@anthropic-ai/sdk';
import { toGeminiContents, callGemini } from './gemini.provider';

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

  /*
    Flash thinks by default, and thinking comes out of the SAME allowance as
    the answer — so a small maxOutputTokens can be spent entirely on thought,
    and `.text` skips thought parts. The result is an empty string that reads
    exactly like an unreadable photo, and the receipt screen would tell the
    person to re-shoot a picture that was perfectly good.
  */
  it('asks for no thinking, because every job here is extraction', async () => {
    const { client: c, generateContent } = client({ text: 'x' });
    await callGemini(c, { model: 'm', messages: [] });
    expect(generateContent.mock.calls[0][0].config.thinkingConfig)
      .toEqual({ thinkingBudget: 0, includeThoughts: false });
  });

  it('treats an empty answer as a failed call, and says why', async () => {
    const { client: c } = client({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(callGemini(c, { model: 'm', messages: [], maxTokens: 400 }))
      .rejects.toThrow(/no usable text.*MAX_TOKENS.*400/s);
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
    await callGemini(c, { model: 'm', messages: [] });
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty('systemInstruction');
  });
});
