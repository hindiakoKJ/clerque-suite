/**
 * Gemini, spoken in Anthropic's dialect.
 *
 * Four features call `AiService.call` with Anthropic-shaped messages — a
 * receipt photo, the journal drafter, the guide, the older OCR route. Rather
 * than rewrite all four and every test that pins their prompts, the Anthropic
 * message shape stays the house language and this file translates it on the
 * way out. Adding a third provider later means another translator, not another
 * rewrite of the callers.
 *
 * Vertex, not the AI Studio key, and deliberately: the Google credit only pays
 * for first-party Google Cloud usage, and — the part that matters for a shop's
 * books — the free AI Studio tier trains on what you send it. A receipt is a
 * client's supplier list and their prices. That is not ours to donate.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';

/** What every provider hands back, whatever it was asked in. */
export interface ProviderResult {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  /**
   * Tokens Gemini served from its own cache. Reported for the usage log only:
   * Google counts them inside promptTokenCount as well, so adding them to the
   * cost would charge for the same tokens twice.
   */
  cachedTokens: number;
}

/**
 * How much room the model may spend thinking before it answers.
 *
 * Flash thinks by default, and — this is the part that bites — thinking is
 * drawn from the SAME maxOutputTokens allowance as the answer. The older OCR
 * route asks for 400 tokens; a Flash call that spends 400 of them thinking
 * returns no answer at all, and the `.text` getter skips thought parts, so
 * what comes back is an empty string that reads exactly like an unreadable
 * photo. Every one of our four jobs is extraction, not reasoning, so the
 * budget is zero unless someone deliberately sets one.
 */
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

/** A Gemini part, narrowed to the two kinds we ever send. */
type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

interface GeminiContent {
  role:  'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Anthropic messages → Gemini contents.
 *
 * Exported and pure so the translation can be tested without a project id, a
 * service account, or a single token of spend.
 */
export function toGeminiContents(messages: Anthropic.MessageParam[]): GeminiContent[] {
  return messages.map((m) => {
    // Gemini calls the assistant "model"; everything else is the user.
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';

    if (typeof m.content === 'string') {
      return { role, parts: [{ text: m.content }] };
    }

    const parts: GeminiPart[] = [];
    for (const block of m.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
        continue;
      }
      if (block.type === 'image' && block.source.type === 'base64') {
        parts.push({
          inlineData: { mimeType: block.source.media_type, data: block.source.data },
        });
        continue;
      }
      /*
        Anything else — a tool result, a URL image, a document — is dropped
        rather than guessed at. Nothing in Clerque sends one today; if
        something starts to, it will show up as a missing instruction in the
        model's answer rather than as a malformed request Google rejects.
      */
    }
    // A message with no part at all is rejected by the API; keep it legal.
    return { role, parts: parts.length > 0 ? parts : [{ text: '' }] };
  });
}

/**
 * One call to Gemini, with the token counts the usage log needs.
 *
 * `cacheSystem` has no equivalent here and is not faked: Anthropic caches when
 * you mark a block, Gemini caches identical prefixes by itself. The saving
 * still happens, it just is not something this code asks for.
 */
export async function callGemini(
  client: GoogleGenAI,
  args: {
    model:         string;
    messages:      Anthropic.MessageParam[];
    systemPrompt?: string;
    maxTokens?:    number;
  },
): Promise<ProviderResult> {
  const response = await client.models.generateContent({
    model:    args.model,
    contents: toGeminiContents(args.messages),
    config: {
      ...(args.systemPrompt ? { systemInstruction: args.systemPrompt } : {}),
      maxOutputTokens: args.maxTokens ?? 1024,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET, includeThoughts: false },
    },
  });

  const usage = response.usageMetadata;
  const text  = (response.text ?? '').trim();

  /*
    An empty answer is a failed call, not an unreadable receipt.

    Without this, running out of room mid-answer returns '' and the receipt
    screen tells the person to take a sharper, flatter photo — a wrong
    diagnosis that has them re-shooting a picture that was fine. Thrown here,
    it lands in AiService's catch, is logged as a failure, and says what
    actually happened.
  */
  const finishReason = response.candidates?.[0]?.finishReason;
  if (!text) {
    throw new Error(
      `Gemini returned no usable text (finishReason=${finishReason ?? 'unknown'}, `
      + `maxOutputTokens=${args.maxTokens ?? 1024}). If this is MAX_TOKENS, the answer did not fit.`,
    );
  }

  return {
    text,
    inputTokens: usage?.promptTokenCount ?? 0,
    /*
      Thoughts are billed as output but reported separately from
      candidatesTokenCount, so leaving them out under-reports the spend the
      budget cap is watching. Zero today because thinking is off, and correct
      the moment anybody turns it on.
    */
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cachedTokens: usage?.cachedContentTokenCount ?? 0,
  };
}
