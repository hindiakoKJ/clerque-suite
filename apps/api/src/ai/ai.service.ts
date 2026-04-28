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

const DEFAULT_MODEL = 'claude-sonnet-4-5';

// Pricing as of Apr 2026 — input + output USD per 1M tokens.
// Vision inputs count toward inputTokens (~1.5k tokens per image typical).
// Update when provider changes pricing; historical rows keep their cost.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5':         { input: 3.0,  output: 15.0  },
  'claude-3-5-sonnet-20241022':{ input: 3.0,  output: 15.0  },
  'claude-3-5-haiku-20241022': { input: 0.8,  output: 4.0   },
};

const DEFAULT_MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 10);

interface CallParams {
  tenantId:    string;
  userId?:     string;
  action:      string;
  /** Optional override; defaults to claude-sonnet-4-5. */
  model?:      string;
  /** Either text or vision messages — passed straight to the SDK. */
  messages:    Anthropic.MessageParam[];
  systemPrompt?: string;
  maxTokens?:  number;
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
    let success = true;
    let errorMessage: string | null = null;
    let textOut = '';

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: params.maxTokens ?? 1024,
        system:     params.systemPrompt,
        messages:   params.messages,
      });
      inputTokens  = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      // Concatenate text blocks; ignore tool blocks for now.
      textOut = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return textOut;
    } catch (err: unknown) {
      success = false;
      errorMessage = err instanceof Error ? err.message : 'Unknown LLM error';
      this.logger.error(`AI call failed (${params.action}): ${errorMessage}`);
      throw new ServiceUnavailableException('AI service temporarily unavailable. Try again or fill in manually.');
    } finally {
      const cost = this.computeCost(model, inputTokens, outputTokens);
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

  /** Dollar cost of a call given token counts and model pricing. */
  private computeCost(model: string, inputTokens: number, outputTokens: number): number {
    const p = PRICING[model] ?? PRICING[DEFAULT_MODEL];
    return ((inputTokens / 1e6) * p.input) + ((outputTokens / 1e6) * p.output);
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
