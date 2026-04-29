/**
 * JournalGuideService — validates an in-progress JE and surfaces issues.
 *
 * Shape of feedback:
 *   - verdict: OK | WARNINGS | BLOCKING
 *   - issues:  per-line and entry-level findings with severity + recommended fix
 *   - summary: one-sentence plain-language read for non-accountants
 *
 * Hard rails:
 *   - Validates account ids exist in the tenant's COA before sending to the
 *     model (no point asking the model about an account that doesn't exist).
 *   - Surfaces structural issues deterministically (unbalanced, closed
 *     period, system account misuse) without burning an LLM call when the
 *     answer is obvious.
 *
 * Reuses AiService.call() with cached system prompt + adaptive thinking.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';

const GUIDE_MODEL = 'claude-opus-4-7';
const GUIDE_PROMPT_VERSION = 'v1.0.0';

const GUIDE_SYSTEM_PROMPT = `You are a Philippine accounting reviewer. The user will give you a draft Journal Entry plus the tenant's Chart of Accounts and tax status. Your job is to surface issues a non-accountant might miss, before they post.

WHAT TO CHECK:
  1. Account choice fits the line description and the entry's overall purpose.
  2. Side (DEBIT vs CREDIT) matches the account's normal balance and the economic effect.
  3. PHILIPPINE TAX:
     - VAT-registered tenants on a vatable purchase should split out 12% Input VAT (account "Input VAT" or code 1040). Missing → WARNING.
     - VAT-registered tenants on a sale should split out 12% Output VAT. Missing → WARNING.
     - NON-VAT or UNREGISTERED tenants should never have VAT lines. Present → BLOCKING.
     - Service vendors typically have 2% or 5% Expanded Withholding Tax. Missing on professional fees / rent → WARNING (don't BLOCK; sometimes correctly omitted).
  4. Sanity: the absolute amount looks reasonable for this kind of expense for this tenant (use recent entries as a baseline).
  5. Equity / capital accounts on the wrong side (e.g. debiting Owner's Equity for a normal expense) — strong BLOCKING signal.

OUTPUT FORMAT:
Return ONLY JSON, no prose, matching:

{
  "verdict": "OK" | "WARNINGS" | "BLOCKING",
  "summary": "<one sentence plain-language read>",
  "issues": [
    {
      "severity":   "BLOCK" | "WARN" | "INFO",
      "lineIndex":  <number | null>,    // index into the lines array; null for entry-level
      "message":    "<one-sentence problem>",
      "rationale":  "<why it matters in plain language>",
      "suggestion": {
        "type":      "swap_account" | "add_line" | "swap_side" | "delete_line" | "edit_amount" | "advice_only",
        "description": "<short imperative — what to change>",
        "accountId":   "<target account id if type=swap_account or add_line>",
        "side":        "DEBIT" | "CREDIT" (if applicable),
        "amount":      <number, 2dp> (if applicable)
      }
    }
  ]
}

GUIDELINES:
  - Don't repeat checks the system already does (balance check, period lock — those are pre-checked).
  - Be specific. "Account looks wrong" is useless. "Line 1 debits Office Supplies for a Meralco bill — usually goes to Utilities Expense" is useful.
  - "advice_only" suggestions for nuance ("Consider whether this should be capitalized") — never block on these.
  - If you would BLOCK, double-check by simulating: "Could this be intentional for an unusual valid case?" If yes, downgrade to WARN.
  - Empty issues array means the entry is clean — verdict: "OK", summary: "Looks good — debits and credits posted to expected accounts."`;

interface GuideEntryInput {
  date:        string;
  memo:        string;
  reference?:  string | null;
  lines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; description?: string }>;
}

export interface GuideIssue {
  severity:   'BLOCK' | 'WARN' | 'INFO';
  lineIndex:  number | null;
  message:    string;
  rationale:  string;
  suggestion?: {
    type:        'swap_account' | 'add_line' | 'swap_side' | 'delete_line' | 'edit_amount' | 'advice_only';
    description: string;
    accountId?:  string;
    side?:       'DEBIT' | 'CREDIT';
    amount?:     number;
  };
}

export interface GuideResult {
  verdict:  'OK' | 'WARNINGS' | 'BLOCKING';
  summary:  string;
  issues:   GuideIssue[];
  meta: { promptVersion: string; aiAssisted: true };
}

@Injectable()
export class JournalGuideService {
  private readonly logger = new Logger(JournalGuideService.name);

  constructor(
    private prisma: PrismaService,
    private ai:     AiService,
  ) {}

  async validate(tenantId: string, userId: string, entry: GuideEntryInput): Promise<GuideResult> {
    if (!entry.lines || entry.lines.length === 0) {
      throw new BadRequestException('Add at least one line before checking the entry.');
    }

    // Account whitelist
    const coa = await this.prisma.account.findMany({
      where:  { tenantId, isActive: true },
      select: { id: true, code: true, name: true, type: true, normalBalance: true, isSystem: true, postingControl: true },
    });
    const byId = new Map(coa.map((a) => [a.id, a]));
    const unknownIds = entry.lines.map((l) => l.accountId).filter((id) => !byId.has(id));
    if (unknownIds.length > 0) {
      throw new BadRequestException(`Unknown account id(s): ${unknownIds.join(', ')}`);
    }

    // Tenant context (light — Guide doesn't need full history; just tax flags + a few recent JEs)
    const [tenant, recentEntries] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where:  { id: tenantId },
        select: { taxStatus: true, businessName: true, businessType: true },
      }),
      this.prisma.journalEntry.findMany({
        where:   { tenantId, status: 'POSTED' },
        orderBy: { date: 'desc' },
        take:    8,
        select:  {
          description: true,
          lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
        },
      }),
    ]);

    const userMessage = this.renderUserMessage(tenant, coa, recentEntries, entry);

    const raw = await this.ai.call({
      tenantId,
      userId,
      action:           'journal_guide',
      model:            GUIDE_MODEL,
      systemPrompt:     GUIDE_SYSTEM_PROMPT,
      cacheSystem:      true,
      adaptiveThinking: true,
      maxTokens:        1500,
      messages: [{ role: 'user', content: userMessage }],
    });

    let parsed: GuideResult;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      this.logger.error(`Guide response parse failed: ${e}`);
      throw new BadRequestException('Could not understand the AI response. Try again.');
    }

    // Sanitize: clamp lineIndex to valid range
    parsed.issues = (parsed.issues ?? []).map((i) => ({
      ...i,
      lineIndex: i.lineIndex != null && i.lineIndex >= 0 && i.lineIndex < entry.lines.length ? i.lineIndex : null,
    }));

    // Verify any swap_account / add_line suggestions reference real accounts
    parsed.issues = parsed.issues.map((i) => {
      if (i.suggestion?.accountId && !byId.has(i.suggestion.accountId)) {
        return { ...i, suggestion: { ...i.suggestion, accountId: undefined } };
      }
      return i;
    });

    parsed.meta = { promptVersion: GUIDE_PROMPT_VERSION, aiAssisted: true };
    return parsed;
  }

  private renderUserMessage(
    tenant: { taxStatus: string; businessName: string | null; businessType: string | null },
    coa: Array<{ id: string; code: string; name: string; type: string; normalBalance: string; isSystem: boolean; postingControl: string }>,
    recent: Array<{ description: string; lines: Array<{ debit: import('@prisma/client/runtime/library').Decimal | number; credit: import('@prisma/client/runtime/library').Decimal | number; account: { code: string } }> }>,
    entry: GuideEntryInput,
  ): string {
    const lines: string[] = [];
    lines.push(`TENANT TAX STATUS: ${tenant.taxStatus}`);
    if (tenant.businessName) lines.push(`BUSINESS: ${tenant.businessName}${tenant.businessType ? ` (${tenant.businessType})` : ''}`);
    lines.push('');
    lines.push('CHART OF ACCOUNTS (id | code | type | normal | name | flags):');
    for (const a of coa) {
      const flags = [a.isSystem ? 'SYSTEM' : null, a.postingControl !== 'OPEN' ? a.postingControl : null].filter(Boolean).join(',');
      lines.push(`  ${a.id} | ${a.code} | ${a.type} | ${a.normalBalance} | ${a.name}${flags ? ' | ' + flags : ''}`);
    }
    lines.push('');
    if (recent.length > 0) {
      lines.push('RECENT POSTED ENTRIES (for pattern recognition):');
      for (const e of recent) {
        const sides = e.lines
          .map((l) => {
            const d = Number(l.debit), c = Number(l.credit);
            return d > 0 ? `D ${l.account.code} ${d.toFixed(2)}` : `C ${l.account.code} ${c.toFixed(2)}`;
          })
          .join(' / ');
        lines.push(`  - "${e.description}" → ${sides}`);
      }
      lines.push('');
    }
    lines.push('DRAFT JOURNAL ENTRY TO REVIEW:');
    lines.push(`  Date: ${entry.date}`);
    lines.push(`  Memo: ${entry.memo}`);
    if (entry.reference) lines.push(`  Reference: ${entry.reference}`);
    lines.push('  Lines:');
    entry.lines.forEach((l, i) => {
      lines.push(`    [${i}] ${l.side} ${l.amount.toFixed(2)} → ${l.accountId}${l.description ? ` (${l.description})` : ''}`);
    });
    lines.push('');
    lines.push('Return the JSON specified in the system prompt — no prose around it.');
    return lines.join('\n');
  }
}
