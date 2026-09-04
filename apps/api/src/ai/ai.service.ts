/**
 * AiService — server-side proxy for all LLM calls.
 *
 * Why a single service:
 *   - Anthropic API key never reaches the browser
 *   - Per-tenant cost tracking + monthly cap enforcement live in one place
 *   - Every call is logged to AiUsage for the cost/audit dashboard
 *   - Switching providers later (Anthropic → OpenAI → on-device) doesn't
 *     change the call sites
 *
 * Cost cap: AI_MONTHLY_BUDGET_USD env var sets the per-tenant cap. The
 * default is permissive (₱500-equivalent / ~$10) so dev tenants don't
 * trip on it. Production should override per-tier.
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { callGemini } from './providers/gemini.provider';
import { isAiEnabled } from './ai-availability';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Model identifiers. Anthropic occasionally publishes new aliases; rather
 * than hardcoding date-stamped IDs that drift, we read each tier from env
 * so ops can swap without a redeploy. Defaults below are the stable public
 * aliases as of 2026 (no date suffix — Anthropic resolves these to the
 * current production snapshot).
 *
 * IMPORTANT: prior versions of this file shipped IDs like "claude-opus-4-7"
 * and "claude-sonnet-4-6" which Anthropic never published — every call
 * returned `model_not_found_error` from the API, surfaced to the user as a
 * generic 503. If you hit a 503 from the AI features, check that the IDs
 * resolved here match what Anthropic actually serves.
 */
export const MODEL_OPUS   = process.env.AI_MODEL_OPUS   ?? 'claude-opus-4-5';
export const MODEL_SONNET = process.env.AI_MODEL_SONNET ?? 'claude-sonnet-4-5';
export const MODEL_HAIKU  = process.env.AI_MODEL_HAIKU  ?? 'claude-haiku-4-5';
const DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL ?? MODEL_SONNET;

/*
  Which provider does the work.

  Gemini Flash by default, on Vertex: it is a quarter of Sonnet's price and a
  twentieth of Opus's, and Vertex is what the Google credit can actually pay
  for. Anthropic stays a one-word switch away, because the receipt matcher was
  tuned against Claude's output and a worse read costs more in re-typing than
  the model ever saves.

  An alias, never a dated snapshot, for the same reason the Claude ids above
  are aliases: Google retires the numbers, not the alias.
*/
export type AiProvider = 'gemini' | 'anthropic';
export const AI_PROVIDER: AiProvider =
  process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini';
export const MODEL_GEMINI = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

// Pricing per 1M tokens (input / output USD). Cache reads cost ~0.1x base
// input; cache writes ~1.25x (5m TTL) or 2x (1h TTL). The keyed lookup falls
// back to DEFAULT_MODEL pricing if a new alias hasn't been added here yet —
// callers are not blocked, but costUsd will be approximate until updated.
const PRICING: Record<string, { input: number; output: number }> = {
  // 4.x family — production aliases
  'claude-opus-4-5':    { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5':  { input:  3.0, output: 15.0 },
  'claude-haiku-4-5':   { input:  1.0, output:  5.0 },
  // Legacy ids kept for any historical AiUsage rows that look them up
  'claude-opus-4-7':    { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6':  { input:  3.0, output: 15.0 },
  /*
    Gemini Flash, list price on Vertex: 0.75 / 3.75 per 1M as an introductory
    rate to 31 Dec 2026, then 1.50 / 7.50. The higher pair is what is written
    here on purpose — a cost estimate that drifts UPWARD on new-year's day is
    a budget cap that fires early, which is the harmless direction. Override
    with GEMINI_PRICE_IN / GEMINI_PRICE_OUT if the rate you actually pay
    differs.
  */
  'gemini-flash-latest': {
    input:  envPrice(process.env.GEMINI_PRICE_IN,  1.5),
    output: envPrice(process.env.GEMINI_PRICE_OUT, 7.5),
  },
};

/**
 * A price from the environment, where BLANK means "not set" and never zero.
 *
 * `??` catches null and undefined; it does not catch the empty string, and
 * `Number('') === 0`. .env.example ships GEMINI_PRICE_IN="" and clearing a
 * variable in Railway leaves an empty string behind — so the plain `??` form
 * priced every call at nothing, which silently retired the monthly budget cap
 * and made the cost dashboard read $0. Nonsense (`1,5` → NaN) falls back too,
 * because a NaN cost poisons the whole monthly aggregate.
 *
 * The same rule as `resolveDailyReadLimit` in the receipt read guard, which
 * learned it first.
 */
function envPrice(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_MONTHLY_BUDGET_USD = envPrice(process.env.AI_MONTHLY_BUDGET_USD, 10);

interface CallParams {
  tenantId:    string;
  userId?:     string;
  action:      string;
  /** Optional override; defaults to DEFAULT_MODEL. */
  model?:      string;
  /** Either text or vision messages — passed straight to the SDK. */
  messages:    Anthropic.MessageParam[];
  systemPrompt?: string;
  maxTokens?:  number;
  /**
   * When true, marks the system prompt with cache_control: ephemeral so identical
   * system prompts hit the prompt cache on subsequent calls (~90% input discount
   * after the first write). Use for stable instruction-heavy prompts (Drafter,
   * Guide). Skip for one-shot prompts where the system text varies per call.
   */
  cacheSystem?: boolean;
  /** Adaptive extended thinking — Opus 4.7 / Sonnet 4.6 only. */
  adaptiveThinking?: boolean;
  /**
   * Override the deployment's provider for this one call. Exists so the same
   * receipt can be put through both and compared; leave it unset otherwise.
   */
  provider?: AiProvider;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;
  private gemini: GoogleGenAI | null = null;

  constructor(private prisma: PrismaService) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) {
      this.client = new Anthropic({ apiKey: key });
    }

    /*
      Vertex reads its credentials the way every Google library does — from
      GOOGLE_APPLICATION_CREDENTIALS, or the metadata server — so there is no
      key to pass here. Project and location are the two things it cannot
      guess.
    */
    const project  = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
    if (project) {
      this.gemini = new GoogleGenAI({ vertexai: true, project, location });
    }

    if (AI_PROVIDER === 'gemini' && !this.gemini) {
      this.logger.warn('AI_PROVIDER=gemini but GOOGLE_CLOUD_PROJECT is not set — AI features will return 503.');
    } else if (AI_PROVIDER === 'anthropic' && !this.client) {
      this.logger.warn('ANTHROPIC_API_KEY is not set — AI features will return 503.');
    }
  }

  /**
   * The model this provider should actually be asked for.
   *
   * Callers name Claude models by constant — the drafter and the guide both
   * ask for Opus. Handing "claude-opus-4-5" to Vertex is a 404 from Google
   * and a puzzled hour for whoever reads the log, so a Claude id is treated
   * as "the strong model, whoever is serving today" and swapped for Flash.
   */
  private resolveModel(provider: AiProvider, requested?: string): string {
    if (provider === 'anthropic') return requested ?? DEFAULT_MODEL;
    return requested && requested.startsWith('gemini') ? requested : MODEL_GEMINI;
  }

  /**
   * Call the LLM, log usage to AiUsage, return the message content.
   * Throws ServiceUnavailable if the API key is missing or provider errors,
   * ForbiddenException if the tenant has hit its monthly budget.
   */
  async call(params: CallParams): Promise<string> {
    // Master switch, checked before anything else. AiQuotaGuard already
    // rejects /ai/* routes, but this is the gate that actually prevents
    // spend: any future caller — a scheduler, an internal service, a route
    // added without the guard — stops here rather than at the provider.
    if (!isAiEnabled()) {
      throw new ServiceUnavailableException(
        'AI features are switched off on this deployment.',
      );
    }

    const provider: AiProvider = params.provider ?? AI_PROVIDER;
    if (provider === 'gemini' ? !this.gemini : !this.client) {
      throw new ServiceUnavailableException('AI service is not configured on this deployment.');
    }

    await this.assertWithinBudget(params.tenantId);

    const model = this.resolveModel(provider, params.model);
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let success = true;
    let errorMessage: string | null = null;
    let textOut = '';

    // System prompt: plain string, or text-block array with ephemeral cache marker
    // when caching is requested. Keeping the prefix-cache marker on the SYSTEM
    // means the deterministic instructions cache, while the per-call user
    // message stays uncached (correct — it's the variable bit).
    const systemParam: string | Anthropic.TextBlockParam[] | undefined =
      !params.systemPrompt
        ? undefined
        : params.cacheSystem
          ? [{ type: 'text', text: params.systemPrompt, cache_control: { type: 'ephemeral' } }]
          : params.systemPrompt;

    try {
      // Note: extended/adaptive thinking is intentionally NOT enabled here.
      // The `{ type: 'adaptive' }` shape we tried earlier is rejected by the
      // current opus/sonnet snapshots with `invalid_request_error: adaptive
      // thinking is not supported on this model`. The proper shape is
      // `{ type: 'enabled', budget_tokens: N }` and only some snapshots
      // accept it. For the JE drafter/guide the prompts are small enough
      // that plain completion is fine; if we ever want thinking back, gate
      // it on a known-good model alias (env-driven) and use the `enabled`
      // shape.
      if (provider === 'gemini') {
        /*
          Google reports promptTokenCount as the WHOLE prompt, cached part
          included, so the cached count is carried for the log and left out
          of the cost — charging it again would bill the same tokens twice.
        */
        const out = await callGemini(this.gemini!, {
          model,
          messages:     params.messages,
          systemPrompt: params.systemPrompt,
          maxTokens:    params.maxTokens,
        });
        inputTokens  = out.inputTokens;
        outputTokens = out.outputTokens;
        textOut      = out.text;
        return textOut;
      }

      const response = await this.client!.messages.create({
        model,
        max_tokens: params.maxTokens ?? 1024,
        ...(systemParam !== undefined ? { system: systemParam } : {}),
        messages: params.messages,
      });
      inputTokens      = response.usage.input_tokens;
      outputTokens     = response.usage.output_tokens;
      cacheReadTokens  = response.usage.cache_read_input_tokens   ?? 0;
      cacheWriteTokens = response.usage.cache_creation_input_tokens ?? 0;
      // Concatenate text blocks; ignore thinking + tool blocks.
      textOut = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return textOut;
    } catch (err: unknown) {
      success = false;
      errorMessage = err instanceof Error ? err.message : 'Unknown LLM error';
      this.logger.error(`AI call failed (${params.action}) model=${model}: ${errorMessage}`);
      // Surface the upstream reason in dev / staging so model-name typos,
      // billing failures, and rate-limit issues are visible. In production
      // we still want the user to see something actionable — show the first
      // line of the provider's error verbatim (short, no stack trace).
      const firstLine = errorMessage.split('\n')[0].slice(0, 240);
      throw new ServiceUnavailableException(
        `AI service unavailable (${model}): ${firstLine}`,
      );
    } finally {
      const cost = this.computeCost(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
      // Fire-and-forget; usage logging must never block the user response.
      this.prisma.aiUsage
        .create({
          data: {
            tenantId:     params.tenantId,
            userId:       params.userId,
            action:       params.action,
            provider,
            model,
            inputTokens,
            outputTokens,
            costUsd:      cost,
            success,
            errorMessage: errorMessage ?? undefined,
            durationMs:   Date.now() - startedAt,
          },
        })
        .catch((e) => this.logger.error(`Failed to log AiUsage: ${e}`));
    }
  }

  /**
   * Dollar cost of a call given token counts and model pricing.
   * Cache reads are ~0.1x base input; cache writes (5m TTL) are ~1.25x.
   * inputTokens here is the uncached portion only (Anthropic returns it that way).
   */
  private computeCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): number {
    const p = PRICING[model] ?? PRICING[DEFAULT_MODEL];
    return (
      (inputTokens      / 1e6) * p.input        +
      (outputTokens     / 1e6) * p.output       +
      (cacheReadTokens  / 1e6) * p.input * 0.1  +
      (cacheWriteTokens / 1e6) * p.input * 1.25
    );
  }

  /**
   * Reject if tenant has spent more than its monthly cap this calendar month.
   *
   * SECURITY M1 — per-tenant budget isolation. The cap is resolved
   * per-tenant so heavy usage by tenant A cannot drain a shared global
   * budget and lock out tenant B. Resolution order:
   *   1. `AI_MONTHLY_BUDGET_USD_BY_TENANT` env var (JSON map of
   *      tenantId → USD cap) — ops override for individual tenants.
   *   2. `DEFAULT_MONTHLY_BUDGET_USD` env fallback.
   *
   * TODO(billing): once a per-tenant USD cap column lands on Tenant
   * (e.g. `aiMonthlyBudgetUsd`) wire it in here ahead of the env map.
   * `tenant.aiQuotaOverride` exists today but is a PROMPT count, not USD,
   * so it cannot stand in for this budget without a unit conversion that
   * would have to assume an average prompt cost.
   */
  private async assertWithinBudget(tenantId: string): Promise<void> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const agg = await this.prisma.aiUsage.aggregate({
      where: { tenantId, createdAt: { gte: startOfMonth } },
      _sum:  { costUsd: true },
    });
    const spent = Number(agg._sum.costUsd ?? 0);
    const budget = this.resolveMonthlyBudgetUsd(tenantId);
    if (spent >= budget) {
      throw new ForbiddenException(
        `AI monthly budget reached ($${spent.toFixed(2)} of $${budget}). ` +
        `Contact your owner to raise the cap.`,
      );
    }
  }

  /** Resolve per-tenant monthly USD cap. See M1 note on assertWithinBudget. */
  private resolveMonthlyBudgetUsd(tenantId: string): number {
    const raw = process.env.AI_MONTHLY_BUDGET_USD_BY_TENANT;
    if (raw) {
      try {
        const map = JSON.parse(raw) as Record<string, number>;
        const perTenant = map?.[tenantId];
        if (typeof perTenant === 'number' && perTenant > 0) return perTenant;
      } catch {
        // malformed map — fall through to default rather than fail-open
        this.logger.warn('AI_MONTHLY_BUDGET_USD_BY_TENANT is not valid JSON; using default.');
      }
    }
    return DEFAULT_MONTHLY_BUDGET_USD;
  }

  /** Per-tenant usage summary for the current calendar month. */
  async getMonthlyUsage(tenantId: string) {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [agg, byAction] = await Promise.all([
      this.prisma.aiUsage.aggregate({
        where: { tenantId, createdAt: { gte: startOfMonth } },
        _sum:  { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.aiUsage.groupBy({
        by:    ['action'],
        where: { tenantId, createdAt: { gte: startOfMonth } },
        _sum:  { costUsd: true },
        _count: true,
      }),
    ]);

    return {
      month: startOfMonth.toISOString().slice(0, 7),
      totalCalls:    agg._count,
      totalCostUsd:  Number(agg._sum.costUsd ?? 0),
      inputTokens:   agg._sum.inputTokens ?? 0,
      outputTokens:  agg._sum.outputTokens ?? 0,
      budgetUsd:     DEFAULT_MONTHLY_BUDGET_USD,
      byAction: byAction.map((b) => ({
        action:    b.action,
        calls:     b._count,
        costUsd:   Number(b._sum.costUsd ?? 0),
      })),
    };
  }
}
