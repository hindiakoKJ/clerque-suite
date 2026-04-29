/**
 * JournalDrafterService — natural-language → Journal Entry draft.
 *
 * Pipeline:
 *   1. Build RAG context: tenant's COA + tax flags + last N similar entries
 *   2. Call Claude Opus 4.7 with adaptive thinking + cached system prompt
 *   3. Parse the model's JSON response, validate every accountId is real
 *   4. Period-lock check on the parsed date BEFORE returning the draft
 *   5. Return the draft + per-field confidence + the prompt version used
 *
 * Hard rails:
 *   - Never auto-posts. Always returns a draft for human review.
 *   - Account whitelist: every accountId must exist in the tenant's COA.
 *   - Period lock: closed periods reject the draft up-front.
 *   - Memo / vendor / amount stay strings until the caller posts the JE
 *     through the existing journal endpoint, which has its own validation.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';

const DRAFTER_MODEL = 'claude-opus-4-7';
const DRAFTER_PROMPT_VERSION = 'v1.0.0';

/**
 * System prompt is intentionally stable — same bytes on every call so the
 * prompt cache hits. Per-call variation goes in the user message (memo,
 * tenant context). See shared/prompt-caching.md.
 */
const DRAFTER_SYSTEM_PROMPT = `You are a Philippine accounting assistant for a SaaS POS+Ledger product.

The user will describe a transaction in plain language. Your job is to draft a
balanced double-entry Journal Entry that uses ONLY accounts from the tenant's
Chart of Accounts (provided in the user message).

PHILIPPINE TAX RULES:
  - VAT-registered tenants: split out 12% Input VAT on vatable purchases (account named "Input VAT" or with code 1040 or similar).
  - VAT-registered tenants on sales: split out 12% Output VAT (account "Output VAT").
  - NON-VAT tenants: never split VAT. Use the gross amount on the expense / revenue line.
  - UNREGISTERED tenants: never split VAT. Treat amounts as gross.
  - Withholding tax (EWT): for service vendors, common rates are 2% (professional fees) and 5% (rent). When in doubt, do NOT add EWT — flag in your "uncertainties" array instead.

OUTPUT FORMAT:
You MUST return a single JSON object matching this exact shape — no prose, no markdown fences:

{
  "date":        "YYYY-MM-DD",
  "memo":        "<concise free-text memo for the entry>",
  "reference":   "<external doc ref if mentioned, else null>",
  "lines": [
    { "accountId": "<exact id from COA>", "side": "DEBIT" | "CREDIT", "amount": <number, 2dp>, "description": "<line memo>" }
  ],
  "confidence": {
    "accountChoice":   <0.0 - 1.0>,
    "amount":          <0.0 - 1.0>,
    "date":            <0.0 - 1.0>,
    "vatTreatment":    <0.0 - 1.0>
  },
  "uncertainties": [ "<short string per concern>" ]
}

CONSTRAINTS:
  - "lines" MUST be balanced: sum(DEBIT amounts) === sum(CREDIT amounts) to 2 decimal places.
  - Every "accountId" MUST be one of the ids in the COA section of the user message. Do not invent ids.
  - "date" must be ISO 8601 format. If the description says "today", use the current date the user provides; "last Tuesday" → resolve to the most recent Tuesday before that date.
  - Round all amounts to 2 decimal places.
  - If the description is ambiguous, lower the corresponding confidence value (don't refuse — surface the doubt and let the user fix it).
  - If the description doesn't describe a real transaction, return lines: [] and put your reasoning in uncertainties.

EXAMPLES OF GOOD UNCERTAINTY ENTRIES:
  - "Date 'last Tuesday' resolved to YYYY-MM-DD; verify if you meant a different week."
  - "Vendor not listed in past entries — confirm Utilities Expense is the right account vs Rent."
  - "VAT-registered tenant but receipt format unclear; assumed VAT-inclusive at 12%."`;

interface DrafterUserContext {
  /** Today as ISO-date string in PH timezone. Used by the model to resolve relative dates. */
  todayPh:           string;
  taxStatus:         'VAT' | 'NON_VAT' | 'UNREGISTERED';
  businessName:      string | null;
  businessType:      string | null;
  /** Trimmed COA — the model needs id, code, name, type, normalBalance. */
  accounts:          Array<{ id: string; code: string; name: string; type: string; normalBalance: 'DEBIT' | 'CREDIT' }>;
  /** Last 10 posted JEs (memo + line accounts) — RAG signal for "what does this tenant usually do". */
  recentEntries:     Array<{ memo: string; lines: Array<{ accountCode: string; side: 'DEBIT' | 'CREDIT'; amount: number }> }>;
}

export interface DrafterResult {
  date:        string;
  memo:        string;
  reference:   string | null;
  lines:       Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; description: string }>;
  confidence:  { accountChoice: number; amount: number; date: number; vatTreatment: number };
  uncertainties: string[];
  meta: {
    promptVersion: string;
    aiAssisted:    true;
  };
}

@Injectable()
export class JournalDrafterService {
  private readonly logger = new Logger(JournalDrafterService.name);

  constructor(
    private prisma: PrismaService,
    private ai:     AiService,
  ) {}

  /**
   * Draft a Journal Entry from a free-text description.
   * Caller (controller) is responsible for caller's tenantId + userId.
   */
  async draft(tenantId: string, userId: string, description: string): Promise<DrafterResult> {
    if (!description || description.trim().length < 5) {
      throw new BadRequestException('Describe the transaction in at least a few words.');
    }

    // Build the RAG context.
    const ctx = await this.buildContext(tenantId);
    const userMessage = this.renderUserMessage(ctx, description);

    const raw = await this.ai.call({
      tenantId,
      userId,
      action:           'journal_drafter',
      model:            DRAFTER_MODEL,
      systemPrompt:     DRAFTER_SYSTEM_PROMPT,
      cacheSystem:      true,        // ~90% input discount on repeated calls
      adaptiveThinking: true,        // Opus 4.7 chooses thinking depth per call
      maxTokens:        2048,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Parse the model output. Salvage the first balanced JSON block if the
    // model wrapped its response in prose (rare with this prompt, but defensive).
    let parsed: DrafterResult;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      this.logger.error(`Drafter response parse failed: ${e}`);
      throw new BadRequestException('AI response was malformed. Try rephrasing the description.');
    }

    // Account whitelist: every accountId must be in the COA we sent.
    const validIds = new Set(ctx.accounts.map((a) => a.id));
    const invalidLine = (parsed.lines ?? []).find((l) => !validIds.has(l.accountId));
    if (invalidLine) {
      throw new BadRequestException(
        `AI suggested an account that doesn't exist (${invalidLine.accountId}). Try rephrasing.`,
      );
    }

    // Period lock: reject up front so the user doesn't draft into a closed period.
    if (parsed.date) {
      await this.assertPeriodOpen(tenantId, parsed.date);
    }

    // Balance check (defensive — the model usually gets this right but never trust)
    const debit  = (parsed.lines ?? []).filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amount || 0), 0);
    const credit = (parsed.lines ?? []).filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amount || 0), 0);
    if (parsed.lines?.length && Math.abs(debit - credit) > 0.01) {
      // Don't reject — flag in uncertainties so the user can see + fix
      parsed.uncertainties = parsed.uncertainties ?? [];
      parsed.uncertainties.unshift(`AI draft is unbalanced: DR ₱${debit.toFixed(2)} vs CR ₱${credit.toFixed(2)}. Adjust before posting.`);
    }

    parsed.meta = { promptVersion: DRAFTER_PROMPT_VERSION, aiAssisted: true };
    return parsed;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async buildContext(tenantId: string): Promise<DrafterUserContext> {
    const [tenant, accounts, recentEntries] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where:  { id: tenantId },
        select: { taxStatus: true, businessName: true, businessType: true },
      }),
      this.prisma.account.findMany({
        where:   { tenantId, isActive: true },
        select:  { id: true, code: true, name: true, type: true, normalBalance: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.journalEntry.findMany({
        where:   { tenantId, status: 'POSTED' },
        orderBy: { date: 'desc' },
        take:    10,
        select:  {
          description: true,
          lines: {
            select: {
              debit: true, credit: true,
              account: { select: { code: true } },
            },
          },
        },
      }),
    ]);

    const todayPh = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }),
    ).toISOString().slice(0, 10);

    return {
      todayPh,
      taxStatus:    tenant.taxStatus as DrafterUserContext['taxStatus'],
      businessName: tenant.businessName,
      businessType: tenant.businessType ?? null,
      accounts:     accounts.map((a) => ({
        id: a.id, code: a.code, name: a.name, type: a.type,
        normalBalance: a.normalBalance as 'DEBIT' | 'CREDIT',
      })),
      recentEntries: recentEntries.map((e) => ({
        memo: e.description,
        lines: e.lines.map((l) => ({
          accountCode: l.account.code,
          side:        Number(l.debit) > 0 ? 'DEBIT' : 'CREDIT' as const,
          amount:      Number(l.debit) > 0 ? Number(l.debit) : Number(l.credit),
        })),
      })),
    };
  }

  private renderUserMessage(ctx: DrafterUserContext, description: string): string {
    const lines: string[] = [];
    lines.push(`TODAY (Asia/Manila): ${ctx.todayPh}`);
    lines.push(`TENANT TAX STATUS: ${ctx.taxStatus}`);
    if (ctx.businessName) lines.push(`BUSINESS: ${ctx.businessName}${ctx.businessType ? ` (${ctx.businessType})` : ''}`);
    lines.push('');
    lines.push('CHART OF ACCOUNTS:');
    for (const a of ctx.accounts) {
      lines.push(`  ${a.code} | ${a.id} | ${a.type} | ${a.normalBalance} | ${a.name}`);
    }
    lines.push('');
    if (ctx.recentEntries.length > 0) {
      lines.push('RECENT POSTED ENTRIES (for pattern recognition only — do NOT echo):');
      for (const e of ctx.recentEntries) {
        const sides = e.lines.map((l) => `${l.side[0]} ${l.accountCode} ${l.amount.toFixed(2)}`).join(' / ');
        lines.push(`  - "${e.memo}" → ${sides}`);
      }
      lines.push('');
    }
    lines.push('TRANSACTION DESCRIPTION:');
    lines.push(description.trim());
    lines.push('');
    lines.push('Return ONLY the JSON object specified in the system prompt.');
    return lines.join('\n');
  }

  private async assertPeriodOpen(tenantId: string, isoDate: string): Promise<void> {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return; // confidence will already be low

    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        startDate: { lte: date },
        endDate:   { gte: date },
      },
      select: { name: true, status: true },
    });
    if (period && period.status === 'CLOSED') {
      throw new BadRequestException(
        `The drafted date falls in ${period.name}, which is closed. Choose a date in an open period.`,
      );
    }
  }
}
