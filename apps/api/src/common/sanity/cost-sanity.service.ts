import { Injectable, Logger } from '@nestjs/common';
import {
  PRICE_SANITY, judgeCost, judgePrice, judgeMargin, isMagnitudeOff, isPackChanged, sanityValueKey,
} from '@repo/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { canSeePurchaseCosts } from '../../procure/cost-visibility';
import { SanityConfirmRequiredException, SanityContext, SanityWarning } from './sanity.types';

/**
 * Delivery costs were saved as printed until this commit, and net of input VAT
 * after it (302040b, "Input VAT: net the shelf and the ledger together"). A
 * VAT-registered shop's older deliveries are therefore already gross, and
 * multiplying them by 1.12 again would move its whole band up by twelve percent.
 */
const NET_LOTS_SINCE = new Date('2026-08-30T10:13:27Z');

/** A mid-shift edit that changed an ingredient's unit leaves this, so older deliveries in the old unit are set aside. */
export const UNIT_CHANGE_ENTITY = 'RawMaterial.unit';

/** A cost this close to the one it is compared with is the same cost. Product costs are kept to the centavo. */
const COST_EPS = 0.005;
const PRICE_EPS = 1e-6;

export interface IngredientCostLine {
  /** Names the box on the screen: 'line:<id>', 'row:<n>', 'rm:<id>:receive' … */
  key: string;
  rawMaterialId: string;
  /** What the supplier charged, VAT included, per the ingredient's own unit. */
  grossPerUnit: number;
  /** When it was typed as a pack price: what one pack held, and what it cost. */
  packSize?: number | null;
  packCost?: number | null;
  /** Where it is being received, so a branch's own prices are preferred. */
  branchId?: string | null;
  /**
   * The pocket that paid, as the receive will see it. The old ten-times guard
   * takes VAT out of the typed cost only when a VAT shop did NOT pay with the
   * owner's own money, and compares the result with the cost on file as it is
   * stored. Deciding "ten times off" on that same basis is what makes a yes
   * to this question always answer the guard's question too.
   */
  paymentMethod?: string | null;
  /**
   * Set when the typed value is ALREADY on the stored basis (Edit Ingredient
   * writes the cost on file directly), so the guard-basis comparison uses it
   * as typed, and the message shows it as typed rather than with VAT added.
   */
  storedBasisPerUnit?: number | null;
}

export interface ProductCheck {
  /** 'product:<id>' or 'product:new' */
  key: string;
  productId?: string;
  name: string;
  priorPrice: number | null;
  price: number;
  /** Null when there is nothing to judge the margin by. */
  cost: number | null;
  /**
   * What it cost to make before this save. A drink that already lost money
   * is not asked about again on every unrelated edit -- only when this save
   * makes it worse, or makes it lose money for the first time.
   */
  priorCost?: number | null;
  vatable: boolean;
  /** Whether it was VAT-able before this save; a flipped flag changes what the shop keeps. */
  priorVatable?: boolean;
  /** True when some ingredient in the recipe has no cost yet, so "suspiciously cheap" means nothing. */
  partlyPriced?: boolean;
  /** Judge the price against the one it replaces. */
  checkPrice: boolean;
  /** Judge what it costs to make against what it sells for. */
  checkMargin: boolean;
}

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 })}`;

function howFar(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  if (ratio >= 2) return `about ${ratio.toFixed(1)} times as much`;
  if (ratio > 1) return `about ${Math.round((ratio - 1) * 100)}% more`;
  if (ratio > 0) return ratio <= 0.5 ? `about ${(1 / ratio).toFixed(1)} times less` : `about ${Math.round((1 - ratio) * 100)}% less`;
  return '';
}

/** A range is one figure when its ends are within half a percent of each other — however small the unit. */
const sameFigure = (low: number, high: number) => high <= low * 1.005 + 1e-9;

/**
 * "Are you sure this is the correct cost?"
 *
 * Asked by the server, before anything is written, for every screen that saves
 * an ingredient cost, a selling price or a recipe. The rules themselves live in
 * @repo/shared-types so the screen can hint with exactly the same judgement
 * while the person is still typing; this service supplies the history they
 * need and decides whether the request has answered the question already.
 */
@Injectable()
export class CostSanityService {
  private readonly logger = new Logger(CostSanityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── ingredient costs ────────────────────────────────────────────────────

  /**
   * Recent purchase prices of each ingredient, VAT included, per its own unit.
   *
   * Newest first. Only real purchases: a write-off's marker lot, a transfer and
   * a kitchen batch are movements, not prices -- and they are left out in the
   * query itself, so a milk that moves between branches every day does not
   * crowd its actual purchases out of the window. A branch's own history is
   * used when it has enough of it -- a kiosk and the main shop can buy at
   * different prices -- and the company's otherwise.
   *
   * Something made in the kitchen (it has a batch yield) has no purchase trend
   * to speak of: only the cost on file is used for it.
   */
  async priceHistory(tenantId: string, rawMaterialIds: string[], branchId?: string | null) {
    const ids = [...new Set(rawMaterialIds)].filter(Boolean);
    const out = new Map<string, {
      name: string; unit: string; points: number[];
      referenceGross: number | null; costOnFile: number | null; usualPackSize: number | null;
    }>();
    if (ids.length === 0) return out;

    const [tenant, materials] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { taxStatus: true } }),
      this.prisma.rawMaterial.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, name: true, unit: true, costPrice: true, batchYield: true },
      }),
    ]);
    const vat = tenant?.taxStatus === 'VAT';
    const window = new Date(Date.now() - PRICE_SANITY.WINDOW_DAYS * 86_400_000);

    await Promise.all(materials.map(async (m) => {
      const [unitChange, lastPack] = await Promise.all([
        this.prisma.auditLog.findFirst({
          where: { tenantId, entityType: UNIT_CHANGE_ENTITY, entityId: m.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.purchaseRequestLine.findFirst({
          where: { rawMaterialId: m.id, receivedAt: { not: null }, packSize: { not: null }, purchaseRequest: { tenantId } },
          orderBy: { receivedAt: 'desc' },
          select: { packSize: true },
        }),
      ]);
      const since = unitChange && unitChange.createdAt > window ? unitChange.createdAt : window;
      const purchases = {
        tenantId, rawMaterialId: m.id, qtyReceived: { gt: 0 }, unitCost: { gt: 0 }, createdAt: { gte: since },
        // Keeps deliveries with no reference at all, which is most of them.
        OR: [
          { referenceNumber: null },
          { AND: [{ NOT: { referenceNumber: { startsWith: 'ST-' } } }, { NOT: { referenceNumber: { startsWith: 'BATCH-' } } }] },
        ],
      };
      const select = { unitCost: true, paymentMethod: true, createdAt: true } as const;
      const [here, anywhere] = m.batchYield != null
        ? [[], []]
        : await Promise.all([
          branchId
            ? this.prisma.rawMaterialLot.findMany({ where: { ...purchases, branchId }, select, orderBy: { receivedAt: 'desc' }, take: PRICE_SANITY.MAX_POINTS })
            : Promise.resolve([] as Array<{ unitCost: unknown; paymentMethod: string | null; createdAt: Date }>),
          this.prisma.rawMaterialLot.findMany({ where: purchases, select, orderBy: { receivedAt: 'desc' }, take: PRICE_SANITY.MAX_POINTS }),
        ]);
      const gross = (l: { unitCost: unknown; paymentMethod: string | null; createdAt: Date }) => {
        const storedNet = vat && l.paymentMethod !== 'OWNER_FUNDED' && l.createdAt >= NET_LOTS_SINCE;
        return Number(l.unitCost) * (storedNet ? 1 + PRICE_SANITY.VAT_RATE : 1);
      };
      const chosen = here.length >= PRICE_SANITY.MIN_TREND_POINTS ? here : anywhere;
      const costOnFile = m.costPrice != null && Number(m.costPrice) > 0 ? Number(m.costPrice) : null;

      out.set(m.id, {
        name: m.name,
        unit: m.unit,
        points: chosen.map(gross),
        // The cost on file is the running average, kept net for a VAT shop.
        referenceGross: costOnFile != null ? costOnFile * (vat ? 1 + PRICE_SANITY.VAT_RATE : 1) : null,
        costOnFile,
        usualPackSize: lastPack?.packSize != null ? Number(lastPack.packSize) : null,
      });
    }));
    return out;
  }

  /**
   * What each ingredient usually costs, for a screen to hint with while the
   * person is still typing. The same history the save is judged by, handed
   * over as numbers so the screen can run the very same rule
   * (@repo/shared-types judgeCost) and never disagree with the server.
   */
  async costBands(tenantId: string, rawMaterialIds: string[], branchId?: string | null) {
    const history = await this.priceHistory(tenantId, rawMaterialIds, branchId);
    return [...history.entries()].map(([rawMaterialId, h]) => ({
      rawMaterialId,
      name: h.name,
      unit: h.unit,
      points: h.points,
      referenceGross: h.referenceGross,
      usualPackSize: h.usualPackSize,
    }));
  }

  /**
   * Judge each typed ingredient cost. Returns the ones worth asking about.
   *
   * With a context that has not opted in, returns nothing without reading any
   * history: a client that cannot be asked should not pay for the question.
   */
  async checkIngredientCosts(tenantId: string, lines: IngredientCostLine[], ctx?: SanityContext): Promise<SanityWarning[]> {
    if (ctx && !ctx.optedIn) return [];
    const priced = lines.filter((l) => l.rawMaterialId && Number.isFinite(l.grossPerUnit) && l.grossPerUnit >= 0);
    if (priced.length === 0) return [];
    const branchId = priced.find((l) => l.branchId)?.branchId ?? null;
    const [history, tenant] = await Promise.all([
      this.priceHistory(tenantId, priced.map((l) => l.rawMaterialId), branchId),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { taxStatus: true, showPurchaseCostsToStaff: true } }),
    ]);
    const vat = tenant?.taxStatus === 'VAT';
    /*
      Someone the shop does not show purchase costs to still gets asked -- the
      price they typed may be wrong -- but the question does not recite what
      the shop usually pays. That band is a price list.
    */
    const showPrices = !ctx?.role || canSeePurchaseCosts(ctx.role, tenant?.showPurchaseCostsToStaff);

    const warnings: SanityWarning[] = [];
    for (const line of priced) {
      const h = history.get(line.rawMaterialId);
      if (!h) continue;
      const verdict = judgeCost({
        typed: line.grossPerUnit,
        history: h.points,
        reference: h.referenceGross,
        packChanged: isPackChanged(line.packSize, h.usualPackSize),
      });
      // Ten times off, on the basis the receive guard itself uses.
      const guardTyped = line.storedBasisPerUnit
        ?? (vat && (line.paymentMethod ?? 'OWNER_FUNDED') !== 'OWNER_FUNDED' ? line.grossPerUnit / (1 + PRICE_SANITY.VAT_RATE) : line.grossPerUnit);
      const magnitude = isMagnitudeOff(line.grossPerUnit, h.referenceGross) || isMagnitudeOff(guardTyped, h.costOnFile);
      if (!verdict.unusual && !magnitude) continue;

      // Say it the way it was typed: per pack when a pack was typed, and on the
      // basis of the box (Edit Ingredient's box holds the cost on file as kept).
      const perPack = line.packSize != null && line.packSize > 0;
      const scale = perPack ? line.packSize! : 1;
      const shownBasis = line.storedBasisPerUnit != null && line.grossPerUnit > 0 ? line.storedBasisPerUnit / line.grossPerUnit : 1;
      const unitLabel = perPack ? `for ${line.packSize!.toLocaleString('en-PH')} ${h.unit}` : `per ${h.unit}`;
      const typedShown = perPack && line.packCost != null ? line.packCost : (line.storedBasisPerUnit ?? line.grossPerUnit) * scale;
      const low = verdict.usualLow != null ? verdict.usualLow * scale * shownBasis : null;
      const high = verdict.usualHigh != null ? verdict.usualHigh * scale * shownBasis : null;
      const usual = low != null && high != null ? (sameFigure(low, high) ? peso(low) : `${peso(low)} to ${peso(high)}`) : null;
      const basis = verdict.basis === 'trend'
        ? `over the last ${verdict.points} deliveries`
        : verdict.points > 0 ? `from the last ${verdict.points === 1 ? 'delivery' : `${verdict.points} deliveries`}` : 'from the cost on file';

      let message: string;
      if (!showPrices) {
        message = magnitude
          ? `${h.name}: ${peso(typedShown)} ${unitLabel} is about ten times off what it usually costs. That is usually the wrong unit${perPack ? ' or pack size' : ''}. Is this the correct cost?`
          : `${h.name}: ${peso(typedShown)} ${unitLabel} is ${verdict.direction === 'low' ? 'well below' : 'well above'} what it usually costs. Is this the correct cost?`;
      } else if (line.grossPerUnit === 0) {
        message = `${h.name}: ${peso(0)} ${unitLabel}. It has usually cost ${usual ?? 'more'} ${basis}, and a free delivery drags the cost of every drink that uses it down. Is this the correct cost?`;
      } else if (magnitude && h.costOnFile != null) {
        const onFile = (line.storedBasisPerUnit != null ? h.costOnFile : (h.referenceGross ?? h.costOnFile)) * scale;
        message = `${h.name}: ${peso(typedShown)} ${unitLabel}, against ${peso(onFile)} ${unitLabel} on file — ${howFar(typedShown / onFile)}. That is usually the wrong unit${perPack ? ' or pack size' : ''}. Is this the correct cost?`;
      } else {
        message = `${h.name}: ${peso(typedShown)} ${unitLabel}. It has usually been ${usual} ${basis}, so this is ${howFar(verdict.ratio)}. Is this the correct cost?`;
      }

      warnings.push({
        key: line.key,
        kind: 'INGREDIENT_COST',
        severity: magnitude ? 'magnitude' : 'unusual',
        name: h.name,
        value: sanityValueKey(line.grossPerUnit),
        message,
        rawMaterialId: line.rawMaterialId,
        typed: typedShown,
        usualLow: showPrices ? low : null,
        usualHigh: showPrices ? high : null,
        points: showPrices ? verdict.points : 0,
        unitLabel,
      });
    }
    return warnings;
  }

  // ── selling prices and margins ──────────────────────────────────────────

  /**
   * What a recipe costs today, from the ingredients' costs on file, and
   * whether any of them has no cost yet. Cost is null when nothing in it is
   * priced.
   */
  async recipeCost(tenantId: string, items: Array<{ rawMaterialId: string; quantity: number }>): Promise<{ cost: number | null; partlyPriced: boolean }> {
    if (!items.length) return { cost: null, partlyPriced: false };
    const rms = await this.prisma.rawMaterial.findMany({
      where: { tenantId, id: { in: [...new Set(items.map((i) => i.rawMaterialId))] } },
      select: { id: true, costPrice: true },
    });
    const cost = new Map(rms.map((r) => [r.id, r.costPrice != null && Number(r.costPrice) > 0 ? Number(r.costPrice) : null]));
    let total = 0;
    let priced = 0;
    for (const i of items) {
      const c = cost.get(i.rawMaterialId);
      if (c == null) continue;
      total += c * Number(i.quantity);
      priced++;
    }
    return { cost: priced > 0 ? total : null, partlyPriced: priced < items.length };
  }

  async checkProduct(tenantId: string, input: ProductCheck, ctx?: SanityContext): Promise<SanityWarning[]> {
    if (ctx && !ctx.optedIn) return [];
    const warnings: SanityWarning[] = [];
    if (!Number.isFinite(input.price) || input.price < 0) return warnings;

    if (input.checkPrice) {
      const v = judgePrice({ prior: input.priorPrice, typed: input.price });
      if (v.unusual && input.priorPrice != null) {
        warnings.push({
          key: `${input.key}:price`,
          kind: 'SELL_PRICE',
          severity: v.ratio != null && (v.ratio >= PRICE_SANITY.MAGNITUDE_FACTOR || (v.ratio > 0 && v.ratio <= 1 / PRICE_SANITY.MAGNITUDE_FACTOR)) ? 'magnitude' : 'unusual',
          name: input.name,
          value: sanityValueKey(input.price),
          message: v.free
            ? `${input.name} was ${peso(input.priorPrice)}. At ${peso(0)} it will ring up free. Is this the correct selling price?`
            : `${input.name} was ${peso(input.priorPrice)}. ${peso(input.price)} is ${howFar(v.ratio)}. Is this the correct selling price?`,
          productId: input.productId,
          typed: input.price,
          usualLow: input.priorPrice,
          usualHigh: input.priorPrice,
          points: 0,
          unitLabel: 'each',
        });
      }
    }

    if (input.checkMargin && input.cost != null) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { taxStatus: true } });
      const vatTenant = tenant?.taxStatus === 'VAT';
      const m = judgeMargin({ cost: input.cost, price: input.price, vatable: input.vatable, vatTenant });
      const before = input.priorCost != null && input.priorPrice != null
        ? judgeMargin({ cost: input.priorCost, price: input.priorPrice, vatable: input.priorVatable ?? input.vatable, vatTenant })
        : null;
      // "Not worse" is judged on what the shop keeps, so a VAT flag flipped on counts as a price cut.
      const lossNotWorse = before?.losesMoney === true
        && input.cost <= input.priorCost! + COST_EPS && m.netPrice >= before.netPrice - PRICE_EPS;
      const cheapNotWorse = before?.suspiciouslyCheap === true
        && input.cost >= input.priorCost! - COST_EPS && m.netPrice <= before.netPrice + PRICE_EPS;
      // A recipe with unpriced ingredients is cheap because it is unfinished, not because a unit is wrong.
      const cheap = m.suspiciouslyCheap && !input.partlyPriced;
      if ((m.losesMoney && !lossNotWorse) || (cheap && !cheapNotWorse)) {
        const afterVat = vatTenant && input.vatable ? ` (${peso(m.netPrice)} after VAT)` : '';
        warnings.push({
          key: `${input.key}:margin`,
          kind: 'MARGIN',
          severity: cheap && !m.losesMoney ? 'magnitude' : 'unusual',
          name: input.name,
          value: `${sanityValueKey(Math.round(input.cost * 100) / 100)}@${sanityValueKey(input.price)}`,
          message: m.losesMoney
            ? `${input.name} costs ${peso(input.cost)} to make and sells for ${peso(input.price)}${afterVat}, so every one sold loses ${peso(input.cost - m.netPrice)}. Is this the correct cost and selling price?`
            : `${input.name} costs only ${peso(input.cost)} to make and sells for ${peso(input.price)}. That is under 1% of the price, which is usually an ingredient cost or recipe quantity in the wrong unit. Is this correct?`,
          productId: input.productId,
          typed: input.cost,
          usualLow: null,
          usualHigh: null,
          points: 0,
          unitLabel: 'to make',
        });
      }
    }
    return warnings;
  }

  // ── asking, and remembering the answer ──────────────────────────────────

  /**
   * Refuse, unless every warning has been answered for exactly this value.
   *
   * Returns the warnings that were confirmed, so the caller can act on them --
   * a confirmed cost lifts the old ten-times guard for that line, since the
   * person has already said the price is right -- and so they can be written
   * down. A client that has not opted in is not refused at all: it gets
   * today's behaviour.
   */
  enforce(warnings: SanityWarning[], ctx: SanityContext | undefined): SanityWarning[] {
    if (!ctx?.optedIn || warnings.length === 0) return [];
    const answered = new Set((ctx.confirmations ?? []).map((c) => `${c.key}=${c.value}`));
    const outstanding = warnings.filter((w) => !answered.has(`${w.key}=${w.value}`));
    if (outstanding.length > 0) throw new SanityConfirmRequiredException(outstanding);
    return warnings;
  }

  /**
   * Who said yes to an unusual number, and to which one.
   *
   * The only record of a price somebody chose to keep after being asked. Best
   * effort: the save already happened, and a lost audit row must not undo it.
   */
  async recordConfirmed(
    tenantId: string,
    userId: string | undefined,
    confirmed: SanityWarning[],
    entityOf: (w: SanityWarning) => { type: string; id: string; value?: string },
  ): Promise<void> {
    for (const w of confirmed) {
      try {
        const entity = entityOf(w);
        await this.prisma.auditLog.create({
          data: {
            tenantId,
            action: 'PRICE_ADJUSTED',
            entityType: entity.type,
            entityId: entity.id,
            description: `Confirmed after being asked: ${w.message}`.slice(0, 1000),
            after: { key: w.key, kind: w.kind, severity: w.severity, value: entity.value ?? w.value, typed: w.typed, usualLow: w.usualLow, usualHigh: w.usualHigh },
            performedBy: userId ?? null,
          },
        });
      } catch (err) {
        this.logger.warn(`[sanity] could not record a confirmed ${w.kind} for ${w.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** Set older deliveries aside when an ingredient changes its unit: they were priced per something else. */
  async recordUnitChange(tenantId: string, rawMaterialId: string, userId: string | undefined, from: string, to: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId, action: 'SETTING_CHANGED', entityType: UNIT_CHANGE_ENTITY, entityId: rawMaterialId,
          before: { unit: from }, after: { unit: to },
          description: `Unit changed from ${from} to ${to}; earlier deliveries no longer set its usual price.`,
          performedBy: userId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`[sanity] could not record a unit change for ${rawMaterialId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
