import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { planLimitsFor, type AiAddonType } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ProcureReceiptsService } from '../procure/procure-receipts.service';
import { ConfirmReceiptDto } from '../procure/dto/receipts.dto';
import { CostSanityService } from '../common/sanity/cost-sanity.service';
import { SanityConfirmRequiredException, SanityContext } from '../common/sanity/sanity.types';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { isAiEnabled, resolveAiQuota } from '../ai/ai-availability';
import { aiPromptsUsedThisMonth } from '../ai/ai-quota.guard';
import { apiKeyActorId } from '../auth/strategies/api-key.strategy';
import { parseDecimal } from './format';
import { ServiceReceiptPostDto, ServiceReceiptReadDto } from './service-receipts.dto';

/**
 * Paid receipts sent through AIBA's Telegram: the one place an API key posts
 * (contract "Paid receipts by Telegram: the one posting exception", KJ
 * 2026-11-17). Scope `procure:receipts` only.
 *
 *   read   Clerque's own receipt reader (ProcureReceiptsService.parse), and
 *          Clerque's own verdict on whether the receipt may post on its own.
 *          Writes nothing.
 *   post   Clerque's own receipt posting (ProcureReceiptsService.confirm):
 *          stock in, the expense from the pocket, the photo kept. In mode
 *          auto only when Clerque's own checks hold, judged here against the
 *          shop's own memory, never against what the body says; otherwise
 *          409 NEEDS_A_PERSON and nothing is posted. In mode confirmed what
 *          a person confirmed in Telegram, new items included.
 *
 * Who posts: the owner who issued the key (ApiKey.createdById), while they
 * are still an active owner, MDM or branch manager of the key's tenant. The
 * stock, the expense and the request are theirs, as if they had posted it on
 * the screen; the request's notes and the audit trail say it came through
 * AIBA, under which key, who sent it on Telegram and who confirmed it.
 */

export interface ReceiptsCaller {
  tenantId:        string;
  keyId:           string;
  label:           string;
  /** The tenant's first active branch, from the key; used when the body names none. */
  defaultBranchId: string | null;
}

export interface ReceiptPostAnswer {
  status:    'POSTED' | 'PARTLY_POSTED' | 'CANCELLED';
  id:        string;
  number:    string;
  reference: string;
  failed?:   Array<{ name?: string; reason?: string }>;
  replayed?: true;
}

/** Roles the key's creator must still hold for a receipt to be read or posted in their name. */
const POSTING_ROLES = new Set(['BUSINESS_OWNER', 'MDM', 'BRANCH_MANAGER']);
/** Roles tied to their own branch (common/branch-scope.ts); the owner is not. */
const BRANCH_ROLES = new Set(['MDM', 'BRANCH_MANAGER']);

/** A line's cost per unit may be this far from the item's last cost either way, and no further. */
export const AUTO_PRICE_BAND = 0.2;
/** The lines and fees must add up to the printed total within this many pesos. */
export const AUTO_TOTAL_TOLERANCE = 1;

const RECEIPT_KIND = 'RECEIPT';
/** A claimed reference with no posting behind it this long is a crashed attempt (as for drafts). */
const ABANDONED_CLAIM_MS = 2 * 60 * 1000;

const peso = (n: number, places = 2) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: places, maximumFractionDigits: places })}`;
const cents = (n: number) => Math.round(n * 100);

interface Actor { id: string; name: string; role: string; branchId: string | null }

@Injectable()
export class ServiceReceiptsService {
  private readonly logger = new Logger(ServiceReceiptsService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly receipts:  ProcureReceiptsService,
    private readonly sanity:    CostSanityService,
    private readonly audit:     AuditService,
    private readonly documents: DocumentsService,
  ) {}

  // ── read ─────────────────────────────────────────────────────────────────

  async read(caller: ReceiptsCaller, dto: ServiceReceiptReadDto) {
    const actor = await this.actingUser(caller);
    await this.assertAiQuota(caller.tenantId);
    const parsed = await this.receipts.parse(caller.tenantId, actor.id, {
      images: dto.images, documentKind: dto.documentKind,
    });
    const why = await this.readVerdict(caller.tenantId, parsed, actor.branchId ?? caller.defaultBranchId);
    return { ...parsed, auto: { ok: why.length === 0, why } };
  }

  /**
   * Would this reading post on its own? Every stock line remembered with its
   * pack size and price, the lines footing to the printed total, the till's
   * item count agreeing, each cost per unit within 20% of the item's last
   * cost, and the receipt not already in. The same checks post runs again.
   */
  private async readVerdict(
    tenantId: string,
    parsed: Awaited<ReturnType<ProcureReceiptsService['parse']>>,
    branchId: string | null,
  ): Promise<string[]> {
    const why: string[] = [];
    if (parsed.lines.length === 0) why.push('No lines were read from the receipt.');
    // KJ's rule is about known items: a receipt with no stock line at all (fees only) is always a person's.
    else if (!parsed.lines.some((l) => l.kind !== 'expense')) why.push('There is no stock line on it; a person confirms a receipt of fees only.');

    const priced: Array<{ label: string; rawMaterialId: string; perUnit: number }> = [];
    for (const l of parsed.lines) {
      if (l.kind === 'expense') continue;
      const label = `Line ${l.index + 1} "${l.description}"`;
      if (!l.remembered || !l.match) {
        why.push(`${label} is not a line the shop confirmed before.`);
      } else if (!l.pack || l.pack.needsPackSize || l.pack.packSize == null || !(l.pack.packSize > 0)) {
        why.push(`${label}: the pack size is not known.`);
      } else if (l.pack.packCost == null || !(l.pack.packCost > 0) || l.pack.packsBought == null) {
        why.push(`${label}: the price or quantity was not read.`);
      } else {
        priced.push({ label, rawMaterialId: l.match.rawMaterialId, perUnit: l.pack.packCost / l.pack.packSize });
      }
    }

    const s = parsed.summary;
    if (s.footsToTotal == null) why.push('No total was read from the receipt.');
    else if (!s.footsToTotal) {
      why.push(`The lines add up to ${peso(s.linesTotal)}, not the printed total ${peso(parsed.total ?? 0)}.`);
    }
    if (s.itemsMatch === false) why.push(`The receipt prints ${s.printedItems} items; ${s.itemsRead} were read.`);

    why.push(...await this.priceWhy(tenantId, priced, branchId));
    why.push(...await this.repeatWhy(tenantId, parsed.vendor, parsed.referenceNumber));
    return why;
  }

  // ── post ─────────────────────────────────────────────────────────────────

  async post(caller: ReceiptsCaller, dto: ServiceReceiptPostDto): Promise<ReceiptPostAnswer> {
    const reference = dto.reference;
    const actor = await this.actingUser(caller);
    const confirmedBy = dto.confirmedBy?.replace(/[[\]]/g, '').trim();
    if (dto.mode === 'confirmed' && !confirmedBy) {
      throw new BadRequestException('confirmedBy is required in mode confirmed: the person who tapped Post.');
    }
    const sentBy = dto.sentBy.replace(/[[\]]/g, '').trim();
    if (!sentBy) throw new BadRequestException('sentBy is required: who sent the receipt on Telegram.');
    const total = Number(parseDecimal(dto.total, 'total', 2));

    // The same reference again: the first answer, nothing posted twice.
    const first = await this.replay(caller, reference);
    if (first) return first;

    const branchId = await this.branchFor(caller, actor, dto.branchId);

    /*
      A request carrying this reference already, with no claim behind it:
      an earlier attempt that died part way. confirm() finishes what it
      started (receiving is idempotent per line), so it is not judged again
      as a new receipt -- the same-receipt check would refuse it as its own
      twin.
    */
    const resuming = await this.prisma.purchaseRequest.findFirst({
      where:  { tenantId: caller.tenantId, notes: { startsWith: `[RCPT:${reference}]` } },
      select: { id: true },
    });

    if (dto.mode === 'auto' && !resuming) {
      const why = await this.autoWhy(caller.tenantId, branchId, dto, total);
      if (why.length > 0) throw this.needsAPerson(why);
    }

    const claimId = await this.claim(caller, reference);
    let answer: ReceiptPostAnswer;
    try {
      answer = await this.postNow(caller, actor, branchId, dto, { reference, sentBy, confirmedBy });
    } catch (err) {
      // Nothing to answer with: free the reference so a corrected retry can use it.
      await this.prisma.serviceDraft.delete({ where: { id: claimId } }).catch(() => undefined);
      throw err;
    }
    await this.prisma.serviceDraft.update({ where: { id: claimId }, data: { targetId: answer.id } });
    return answer;
  }

  /**
   * Mode auto: Clerque checks the receipt again itself, against the shop's
   * own memory and books. Every reason it may not post on its own, or none.
   */
  private async autoWhy(tenantId: string, branchId: string, dto: ServiceReceiptPostDto, total: number): Promise<string[]> {
    const why: string[] = [];
    const lines = dto.lines ?? [];
    // KJ's rule is about known items: a receipt with no stock line at all (fees only) is always a person's.
    if (lines.length === 0) why.push('There is no stock line on it; a person confirms a receipt of fees only.');
    const memory = await this.receipts.recall(tenantId, lines.map((l) => ({ printedText: l.printedText, barcode: l.barcode })));

    const priced: Array<{ label: string; rawMaterialId: string; perUnit: number }> = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1}${l.printedText?.trim() ? ` "${l.printedText.trim()}"` : ''}`;
      if (l.create) {
        why.push(`${label} would create a new item; a person confirms new items.`);
        return;
      }
      if (!l.printedText?.trim() && !l.barcode?.trim()) {
        why.push(`${label} has no printed text or barcode to check against what the shop confirmed before.`);
        return;
      }
      const known = memory[i];
      if (!known) {
        why.push(`${label} is not a line the shop confirmed before.`);
      } else if (known.rawMaterialId !== l.rawMaterialId) {
        why.push(`${label} was confirmed before as a different item.`);
      } else if (known.packSize == null || Math.abs(known.packSize - l.packSize) > 1e-4) {
        why.push(`${label}: pack size ${l.packSize} is not the ${known.packSize ?? 'unknown'} confirmed before.`);
      } else {
        priced.push({ label, rawMaterialId: known.rawMaterialId, perUnit: l.packCost / l.packSize });
      }
    });

    const sum = lines.reduce((s, l) => s + l.packsBought * l.packCost, 0)
      + (dto.expenses ?? []).reduce((s, e) => s + e.amount, 0);
    if (Math.abs(cents(sum) - cents(total)) > cents(AUTO_TOTAL_TOLERANCE)) {
      why.push(`The lines and fees add up to ${peso(sum)}, not the printed total ${peso(total)}.`);
    }

    why.push(...await this.priceWhy(tenantId, priced, branchId));
    why.push(...await this.repeatWhy(tenantId, dto.vendor, dto.referenceNumber));
    return why;
  }

  /** Clerque's own receipt posting, as the key's creator, with the sanity question asked. */
  private async postNow(
    caller: ReceiptsCaller,
    actor: Actor,
    branchId: string,
    dto: ServiceReceiptPostDto,
    who: { reference: string; sentBy: string; confirmedBy?: string },
  ): Promise<ReceiptPostAnswer> {
    const auto = dto.mode === 'auto';
    const label = caller.label.replace(/[[\]]/g, '').trim();
    const note = `Through AIBA (key ${label}); sent by ${who.sentBy} on Telegram`
      + (auto ? '' : `; confirmed by ${who.confirmedBy}`);
    const photo = dto.images?.[0];
    const confirmDto = {
      branchId,
      vendor:          dto.vendor,
      receiptDate:     dto.receiptDate,
      referenceNumber: dto.referenceNumber,
      paymentMethod:   dto.paymentMethod ?? 'OWNER_FUNDED',
      // In mode auto nothing waves the old ten-times cost guard through: no
      // person has looked. (Every line is within 20% of its last cost anyway.)
      lines:           auto ? dto.lines.map(({ acceptCostChange: _ignored, ...l }) => l) : dto.lines,
      expenses:        dto.expenses ?? [],
      idempotencyKey:  who.reference,
      ...(photo ? { imageBase64: photo.base64, mediaType: photo.mediaType } : {}),
    } as ConfirmReceiptDto;
    // Always asked: in mode auto nobody can answer, so any question is a "no".
    const sanity: SanityContext = {
      optedIn:       true,
      confirmations: auto ? [] : (dto.sanityConfirmations ?? []),
      userId:        actor.id,
      role:          actor.role,
    };

    let result: Awaited<ReturnType<ProcureReceiptsService['confirm']>>;
    try {
      result = await this.receipts.confirm(caller.tenantId, actor.id, branchId, confirmDto, sanity, { note });
    } catch (err) {
      if (err instanceof SanityConfirmRequiredException) {
        if (auto) throw this.needsAPerson(err.warnings.map((w) => w.message));
        throw new ConflictException({
          code:     'SANITY',
          warnings: err.warnings,
          message:  err.warnings.map((w) => w.message),
        });
      }
      // The same store and receipt number got in a moment ago.
      if (auto && err instanceof ConflictException) throw this.needsAPerson([this.messageOf(err)]);
      throw err;
    }

    const request = result.request as { id: string; requestNumber: string };
    const failed = [
      ...((result.failed ?? []) as Array<{ name?: string; reason?: string }>).map((f) => ({ name: f.name, reason: f.reason })),
      ...((result.expenses ?? []) as Array<{ description: string; error?: string }>)
        .filter((e) => e.error).map((e) => ({ name: e.description, reason: e.error })),
    ];

    // The other strips of a long receipt, kept beside the first.
    if (!result.duplicate && (dto.images?.length ?? 0) > 1) {
      for (const [i, strip] of dto.images!.slice(1).entries()) {
        try {
          const mime = strip.mediaType ?? 'image/jpeg';
          const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
          await this.documents.uploadBuffer(
            caller.tenantId, 'PurchaseRequest', request.id, Buffer.from(strip.base64, 'base64'), mime,
            `receipt-${request.requestNumber}-${i + 2}.${ext}`, 'Receipt', actor.id,
          );
        } catch (err) {
          this.logger.warn(`Receipt strip ${i + 2} of ${request.requestNumber} not filed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const receiptLabel = [dto.vendor?.trim(), dto.referenceNumber?.trim()].filter(Boolean).join(' · ');
    try {
      await this.audit.log({
        tenantId:    caller.tenantId,
        // No action of its own yet (one would need a migration); the record says what it was.
        action:      'SERVICE_DRAFT_CREATED',
        entityType:  'PurchaseRequest',
        entityId:    request.id,
        performedBy: apiKeyActorId(caller.keyId),
        description: `${note}. Paid receipt${receiptLabel ? ` ${receiptLabel}` : ''} posted as ${request.requestNumber} `
          + `in the name of ${actor.name} (reference ${who.reference}, mode ${dto.mode}).`,
        after: {
          kind: 'PAID_RECEIPT_POSTED', reference: who.reference, mode: dto.mode, requestNumber: request.requestNumber,
          apiKeyId: caller.keyId, apiKeyLabel: caller.label, actingUserId: actor.id, sentBy: who.sentBy,
          confirmedBy: who.confirmedBy ?? null, failed: failed.length,
        },
      });
    } catch (err) {
      // The receipt stands; an audit write that failed is logged, not hidden.
      this.logger.error(`Audit log for receipt ${request.id} failed: ${err instanceof Error ? err.message : err}`);
    }

    return {
      status:    failed.length ? 'PARTLY_POSTED' : 'POSTED',
      id:        request.id,
      number:    request.requestNumber,
      reference: who.reference,
      ...(failed.length ? { failed } : {}),
    };
  }

  // ── the checks both routes share ─────────────────────────────────────────

  /**
   * No line's cost per unit more than 20% above or below the item's last
   * cost: the newest purchase price the cost question itself uses (VAT
   * included, as a receipt prints it), or the running average on file when
   * there is no recent purchase. No cost to compare with is a reason too.
   */
  private async priceWhy(
    tenantId: string,
    lines: Array<{ label: string; rawMaterialId: string; perUnit: number }>,
    branchId: string | null,
  ): Promise<string[]> {
    if (lines.length === 0) return [];
    const history = await this.sanity.priceHistory(tenantId, lines.map((l) => l.rawMaterialId), branchId);
    const why: string[] = [];
    for (const l of lines) {
      const h = history.get(l.rawMaterialId);
      const last = h?.points[0] ?? h?.referenceGross ?? null;
      if (last == null || !(last > 0)) {
        why.push(`${l.label}: there is no earlier cost to compare its price with.`);
        continue;
      }
      const off = l.perUnit / last - 1;
      if (Math.abs(off) > AUTO_PRICE_BAND + 1e-9) {
        why.push(`${l.label}: ${peso(l.perUnit, 4)} per ${h!.unit} is ${Math.round(Math.abs(off) * 100)}% `
          + `${off > 0 ? 'above' : 'below'} its last cost of ${peso(last, 4)}.`);
      }
    }
    return why;
  }

  /** Not posted before under the same store and receipt number -- which takes a receipt number. */
  private async repeatWhy(tenantId: string, vendor: string | null | undefined, referenceNumber: string | null | undefined): Promise<string[]> {
    if (!referenceNumber?.trim()) return ['No receipt number, so a repeat of an earlier receipt cannot be ruled out.'];
    const twin = await this.receipts.alreadyReceived(tenantId, vendor, referenceNumber);
    if (!twin) return [];
    const label = [vendor?.trim(), referenceNumber.trim()].filter(Boolean).join(' · ');
    return [`Receipt ${label} is already in (request ${twin}).`];
  }

  // ── who, where, and how much AI ──────────────────────────────────────────

  /**
   * The owner who issued the key, while they are still an active owner, MDM
   * or branch manager of the key's own tenant. Otherwise nothing is read or
   * posted in their name.
   */
  private async actingUser(caller: ReceiptsCaller): Promise<Actor> {
    const key = await this.prisma.apiKey.findFirst({
      where:  { id: caller.keyId, tenantId: caller.tenantId },
      select: { createdById: true },
    });
    const user = key
      ? await this.prisma.user.findFirst({
          where:  { id: key.createdById, tenantId: caller.tenantId },
          select: { id: true, name: true, role: true, isActive: true, branchId: true },
        })
      : null;
    if (!user || !user.isActive || !POSTING_ROLES.has(String(user.role))) {
      throw new ForbiddenException({
        code:    'KEY_OWNER_CANNOT_POST',
        message: 'Receipts go in under the person who issued this key, and they are no longer an active owner, MDM '
          + 'or branch manager of this business. An active owner issues a new key.',
      });
    }
    return { id: user.id, name: user.name, role: String(user.role), branchId: user.branchId ?? null };
  }

  /** The branch the receipt goes to: the creator's own for a branch role, else the one named or the key's default. */
  private async branchFor(caller: ReceiptsCaller, actor: Actor, requested?: string): Promise<string> {
    let branchId = requested;
    if (BRANCH_ROLES.has(actor.role) && actor.branchId) {
      if (requested && requested !== actor.branchId) {
        throw new ForbiddenException('The person this key posts as works at one branch and cannot post to another.');
      }
      branchId = actor.branchId;
    }
    branchId = branchId ?? caller.defaultBranchId ?? undefined;
    if (!branchId) throw new BadRequestException('branchId is required: which branch received this?');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId: caller.tenantId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found.');
    return branch.id;
  }

  /**
   * The monthly AI allowance the app's own Read button is held to
   * (AiQuotaGuard), worked out from the tenant because a key carries no
   * quota of its own. The daily cap is the route's guard.
   */
  private async assertAiQuota(tenantId: string): Promise<void> {
    if (!isAiEnabled()) {
      throw new ForbiddenException({ code: 'AI_DISABLED', message: 'AI features are temporarily unavailable.' });
    }
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { planCode: true, aiAddonType: true, aiAddonExpiresAt: true, aiQuotaOverride: true },
    });
    const quota = resolveAiQuota({
      planIncluded:   planLimitsFor(tenant?.planCode).maxAiPerMonth,
      addonType:      (tenant?.aiAddonType ?? null) as AiAddonType | null,
      addonExpiresAt: tenant?.aiAddonExpiresAt ?? null,
      override:       tenant?.aiQuotaOverride ?? null,
    }).monthlyQuota;
    if (quota <= 0) {
      throw new ForbiddenException({ code: 'AI_NOT_ENABLED', message: 'AI features are not active on this account.' });
    }
    const used = await aiPromptsUsedThisMonth(this.prisma, tenantId);
    if (used >= quota) {
      throw new ForbiddenException({
        code: 'AI_QUOTA_EXCEEDED', monthlyQuota: quota, usedThisMonth: used,
        message: `All ${quota} AI prompts of this month are used.`,
      });
    }
  }

  // ── once per reference ───────────────────────────────────────────────────

  /**
   * The first answer for this reference, if there is one. Shares the
   * service_drafts table with the drafts (kind RECEIPT), so a reference names
   * one thing across every /service route, and two retries racing cannot
   * both post.
   */
  private async replay(caller: ReceiptsCaller, reference: string): Promise<ReceiptPostAnswer | null> {
    const prior = await this.prisma.serviceDraft.findUnique({
      where:  { tenantId_reference: { tenantId: caller.tenantId, reference } },
      select: { id: true, kind: true, targetId: true, createdAt: true },
    });
    if (!prior) return null;
    if (prior.kind !== RECEIPT_KIND) {
      throw new ConflictException(`Reference ${reference} was already used for a draft, not a receipt.`);
    }
    if (!prior.targetId) {
      if (Date.now() - prior.createdAt.getTime() > ABANDONED_CLAIM_MS) {
        await this.prisma.serviceDraft.deleteMany({ where: { id: prior.id, targetId: null } });
        return null;
      }
      throw new ConflictException('A receipt with this reference is being posted; try again in a moment.');
    }
    const request = await this.prisma.purchaseRequest.findFirst({
      where:  { id: prior.targetId, tenantId: caller.tenantId },
      select: { id: true, requestNumber: true, status: true },
    });
    const status = request?.status === 'CANCELLED' ? 'CANCELLED' : request?.status === 'BOUGHT' ? 'PARTLY_POSTED' : 'POSTED';
    return { status, id: prior.targetId, number: request?.requestNumber ?? '', reference, replayed: true };
  }

  private async claim(caller: ReceiptsCaller, reference: string): Promise<string> {
    try {
      return (await this.prisma.serviceDraft.create({
        data:   { tenantId: caller.tenantId, apiKeyId: caller.keyId, reference, kind: RECEIPT_KIND },
        select: { id: true },
      })).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A receipt with this reference is being posted; try again in a moment.');
      }
      throw err;
    }
  }

  private needsAPerson(why: string[]): ConflictException {
    return new ConflictException({ code: 'NEEDS_A_PERSON', why, message: why });
  }

  private messageOf(err: ConflictException): string {
    const r = err.getResponse();
    const m = typeof r === 'object' && r ? (r as { message?: unknown }).message : r;
    return Array.isArray(m) ? m.join(' ') : String(m ?? err.message);
  }
}
