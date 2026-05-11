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
};

const DEFAULT_MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 10);

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
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  constructor(private prisma: PrismaService) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) {
      this.client = new Anthropic({ apiKey: key });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY is not set — AI features will return 503.');
    }
  }

  /**
   * Call the LLM, log usage to AiUsage, return the message content.
   * Throws ServiceUnavailable if the API key is missing or provider errors,
   * ForbiddenException if the tenant has hit its monthly budget.
   */
  async call(params: CallParams): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException('AI service is not configured on this deployment.');
    }

    await this.assertWithinBudget(params.tenantId);

    const model = params.model ?? DEFAULT_MODEL;
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
      const response = await this.client.messages.create({
        model,
        max_tokens: params.maxTokens ?? 1024,
        ...(systemParam !== undefined ? { system: systemParam } : {}),
        ...(params.adaptiveThinking
          ? { thinking: { type: 'adaptive' as const } }
          : {}),
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
            provider:     'anthropic',
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

  /** Reject if tenant has spent more than DEFAULT_MONTHLY_BUDGET_USD this calendar month. */
  private async assertWithinBudget(tenantId: string): Promise<void> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const agg = await this.prisma.aiUsage.aggregate({
      where: { tenantId, createdAt: { gte: startOfMonth } },
      _sum:  { costUsd: true },
    });
    const spent = Number(agg._sum.costUsd ?? 0);
    if (spent >= DEFAULT_MONTHLY_BUDGET_USD) {
      throw new ForbiddenException(
        `AI monthly budget reached ($${spent.toFixed(2)} of $${DEFAULT_MONTHLY_BUDGET_USD}). ` +
        `Contact your owner to raise the cap.`,
      );
    }
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
