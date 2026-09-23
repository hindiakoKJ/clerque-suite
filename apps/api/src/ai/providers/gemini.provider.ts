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
// Types only — importing a VALUE from this module would make the SDK a load-time
// dependency of the translator, and ai.vertex-only.spec.ts mocks it to a stub.
import type { GoogleGenAI, ThinkingConfig, ThinkingLevel } from '@google/genai';

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
 * A whole number from the environment, where BLANK means "not set".
 *
 * Same rule as `envPrice` in ai.service.ts, and for the same reason: `??`
 * does not catch the empty string, `Number('')` is 0, and clearing a variable
 * in Railway leaves an empty string behind. Here a silent 0 would mean "no
 * thinking at all" or "no output allowance at all" — neither is what an
 * emptied field was asking for.
 */
function envInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * A word from the environment, where BLANK means "not set".
 *
 * The same trap as `envInt` above, one type over. `??` keeps an empty string,
 * and `''.toUpperCase()` is still `''` — so emptying the field in Railway,
 * which is how anyone says "go back to the default", sent Google an empty
 * `thinkingLevel`. That is not a missing value to Vertex, it is an invalid
 * enum: the request is rejected before a token is generated, and EVERY AI
 * button in the app answers 503 until somebody notices which box they
 * cleared.
 */
function envText(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * How much room the model may spend thinking before it answers.
 *
 * Flash thinks by default, and — this is the part that bites — thinking is
 * drawn from the SAME maxOutputTokens allowance as the answer. The older OCR
 * route asks for 400 tokens; a Flash call that spends 400 of them thinking
 * returns no answer at all, and the `.text` getter skips thought parts, so
 * what comes back is an empty string that reads exactly like an unreadable
 * photo. Every one of our four jobs is extraction, not reasoning, so we ask
 * for as little thinking as the model on duty will accept.
 *
 * Which is where the two generations differ, and why this is not one setting:
 *
 *   Gemini 2.5 takes `thinkingBudget`, a token count, and 0 means OFF.
 *   Gemini 3 takes `thinkingLevel` — and cannot be switched off at all. LOW
 *   is the floor on 3.x Flash; "MINIMAL" exists in the SDK but 3.8 Flash
 *   REJECTS it, failing the request before a token is generated. Sending
 *   both fields together is also an error.
 *
 * So the shape follows the model id, and an id we do not recognise (an alias,
 * something newer) is treated as the new generation, which is the direction
 * the world moves in.
 */
const THINKING_BUDGET = envInt(process.env.GEMINI_THINKING_BUDGET, 0);
const THINKING_LEVEL  = envText(process.env.GEMINI_THINKING_LEVEL, 'LOW').toUpperCase();

/**
 * The smallest output allowance a thinking model is given, regardless of what
 * the caller asked for.
 *
 * Gemini 3 cannot stop thinking, maxOutputTokens is a hard cutoff that counts
 * thought tokens, and the receipt route asks for 400 — which the model would
 * spend entirely on thought and return nothing. Raising a CEILING costs
 * nothing: Google bills tokens produced, not tokens allowed. So the floor is
 * headroom, not spend, and it is the difference between a receipt that reads
 * and a cashier being told to re-shoot a photo that was fine.
 */
const MIN_OUTPUT_TOKENS = Math.max(1, envInt(process.env.GEMINI_MIN_OUTPUT_TOKENS, 2048));

/** The major version in a Gemini id, or null for an alias we cannot read. */
function geminiMajorVersion(model: string): number | null {
  const match = /^gemini-(\d+)[.-]/.exec(model);
  return match ? Number(match[1]) : null;
}

/**
 * True for Gemini 3 and anything we cannot place — the generation that takes
 * `thinkingLevel` and cannot be told to stop thinking.
 */
export function usesThinkingLevel(model: string): boolean {
  const major = geminiMajorVersion(model);
  return major === null || major >= 3;
}

/**
 * The thinking settings this model will actually accept. Never both fields.
 *
 * Typed against the SDK's own ThinkingConfig so a renamed or mistyped field
 * is a compile error here rather than a 400 from Google at the till.
 */
export function thinkingConfigFor(model: string): ThinkingConfig {
  return usesThinkingLevel(model)
    ? { thinkingLevel: THINKING_LEVEL as ThinkingLevel, includeThoughts: false }
    : { thinkingBudget: THINKING_BUDGET, includeThoughts: false };
}

/** The output allowance to send: what the caller asked, floored for thinkers. */
export function outputTokenCeiling(model: string, requested?: number): number {
  const asked = requested ?? 1024;
  return usesThinkingLevel(model) ? Math.max(asked, MIN_OUTPUT_TOKENS) : asked;
}

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
  const maxOutputTokens = outputTokenCeiling(args.model, args.maxTokens);

  const response = await client.models.generateContent({
    model:    args.model,
    contents: toGeminiContents(args.messages),
    config: {
      ...(args.systemPrompt ? { systemInstruction: args.systemPrompt } : {}),
      maxOutputTokens,
      thinkingConfig: thinkingConfigFor(args.model),
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
      + `maxOutputTokens=${maxOutputTokens}). If this is MAX_TOKENS, the answer did not fit — `
      + `raise GEMINI_MIN_OUTPUT_TOKENS.`,
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
