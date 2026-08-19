import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaxCalculatorService, round2 } from '../tax/tax.service';
import type { TaxStatus } from '../tax/tax.service';

/* ─── Wire shapes ─────────────────────────────────────────────────────────── */

export interface QuoteLineRequest {
  productId:  string;
  variantId?: string;
  quantity:   number;
  /** ModifierOption ids selected for this line (size upgrades, add-ons). */
  modifierOptionIds?: string[];
}

export interface QuoteRequest {
  items: QuoteLineRequest[];
  /** Apply the RA 9994 / RA 7277 20% PWD-SC discount to the whole sale. */
  isPwdScDiscount?: boolean;
}

export interface QuoteLine {
  productId:   string;
  variantId:   string | null;
  productName: string;
  quantity:    number;
  /** Base price + modifier adjustments, per unit. */
  unitPrice:   number;
  lineTotal:   number;
  isVatable:   boolean;
  modifiers: {
    modifierGroupId: string;
    modifierOptionId: string;
    groupName:       string;
    optionName:      string;
    priceAdjustment: number;
  }[];
}

export interface Quote {
  lines:           QuoteLine[];
  subtotal:        number;
  discountAmount:  number;
  vatAmount:       number;
  totalAmount:     number;
  isPwdScDiscount: boolean;
  taxStatus:       TaxStatus;
  /** Tenant's currency is always PHP today; stated so callers don't assume. */
  currency:        'PHP';
}

/* ─── Service ─────────────────────────────────────────────────────────────── */

/**
 * Server-side pricing for a cart.
 *
 * This is the boundary rule of the platform made concrete: a consumer app
 * describes INTENT ("2 hours of Court 3, plus racket rental") and Clerque
 * decides the MONEY. An external app never computes VAT, never picks a
 * price, and never submits either as truth.
 *
 * Everything here is read-only — quoting creates nothing and reserves
 * nothing. Call it as often as you like while the customer builds a cart,
 * then send the result to POST /orders.
 */
@Injectable()
export class OrderQuoteService {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly taxCalc: TaxCalculatorService,
  ) {}

  /** Skips the round-trip when no line names a variant. */
  private async loadVariants(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    return this.prisma.productVariant.findMany({
      where:  { id: { in: ids }, isActive: true, product: { tenantId } },
      select: { id: true, name: true, price: true, productId: true },
    });
  }

  /** Skips the round-trip when no line has modifiers. */
  private async loadModifierOptions(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    return this.prisma.modifierOption.findMany({
      where:  { id: { in: ids }, isActive: true, group: { tenantId } },
      select: {
        id: true, name: true, priceAdjustment: true, modifierGroupId: true,
        group: { select: { name: true } },
      },
    });
  }

  async quote(tenantId: string, req: QuoteRequest): Promise<Quote> {
    const items = req.items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('At least one item is required.');
    }
    // A cart this long is a bug or an abuse attempt, not a real sale.
    if (items.length > 200) {
      throw new BadRequestException('A quote cannot contain more than 200 lines.');
    }

    for (const [i, line] of items.entries()) {
      if (!line?.productId || typeof line.productId !== 'string') {
        throw new BadRequestException(`Item ${i + 1}: productId is required.`);
      }
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new BadRequestException(`Item ${i + 1}: quantity must be greater than zero.`);
      }
      // Fractional quantities are legitimate for weighed goods, but the
      // absurd ones are how you get a rounding exploit.
      if (line.quantity > 100_000) {
        throw new BadRequestException(`Item ${i + 1}: quantity is unreasonably large.`);
      }
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { taxStatus: true },
    });
    const taxStatus = (tenant.taxStatus ?? 'UNREGISTERED') as TaxStatus;

    /* ── Load every referenced record, scoped to this tenant ──────────────
     * One query per entity type rather than per line: a 200-line cart must
     * not become 600 round-trips. Tenant scoping is in the WHERE clause, so
     * a foreign id simply does not come back and fails the check below. */
    const productIds = [...new Set(items.map((i) => i.productId))];
    const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v))];
    const optionIds  = [...new Set(items.flatMap((i) => i.modifierOptionIds ?? []))];

    const [products, variants, options] = await Promise.all([
      this.prisma.product.findMany({
        where:  { id: { in: productIds }, tenantId, isActive: true },
        select: { id: true, name: true, price: true, isVatable: true },
      }),
      this.loadVariants(tenantId, variantIds),
      this.loadModifierOptions(tenantId, optionIds),
    ]);

    const productById = new Map(products.map((p) => [p.id, p] as const));
    const variantById = new Map(variants.map((v) => [v.id, v] as const));
    const optionById  = new Map(options.map((o) => [o.id, o] as const));

    /* ── Price each line ─────────────────────────────────────────────── */
    const lines: QuoteLine[] = items.map((line, i) => {
      const product = productById.get(line.productId);
      if (!product) {
        throw new BadRequestException(
          `Item ${i + 1}: product not found, inactive, or not in your organization.`,
        );
      }

      let variantName: string | null = null;
      // A variant's price overrides the product's when set; a null price
      // means "same as the base product" (common for colour/flavour variants).
      let basePrice = Number(product.price);
      if (line.variantId) {
        const variant = variantById.get(line.variantId);
        if (!variant || variant.productId !== product.id) {
          throw new BadRequestException(
            `Item ${i + 1}: variant not found or does not belong to this product.`,
          );
        }
        variantName = variant.name;
        if (variant.price !== null) basePrice = Number(variant.price);
      }

      const modifiers = (line.modifierOptionIds ?? []).map((optId) => {
        const opt = optionById.get(optId);
        if (!opt) {
          throw new BadRequestException(
            `Item ${i + 1}: modifier option not found, inactive, or not in your organization.`,
          );
        }
        return {
          modifierGroupId:  opt.modifierGroupId,
          modifierOptionId: opt.id,
          groupName:        opt.group?.name ?? '',
          optionName:       opt.name,
          priceAdjustment:  round2(Number(opt.priceAdjustment)),
        };
      });

      const modifierTotal = modifiers.reduce((s, m) => s + m.priceAdjustment, 0);
      const unitPrice = round2(basePrice + modifierTotal);
      if (unitPrice < 0) {
        throw new BadRequestException(
          `Item ${i + 1}: modifiers reduce the price below zero.`,
        );
      }

      return {
        productId:   product.id,
        variantId:   line.variantId ?? null,
        productName: variantName ? `${product.name} (${variantName})` : product.name,
        quantity:    line.quantity,
        unitPrice,
        lineTotal:   round2(unitPrice * line.quantity),
        isVatable:   product.isVatable,
        modifiers,
      };
    });

    /* ── Roll up to the order ────────────────────────────────────────── */
    const grossSubtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

    if (req.isPwdScDiscount) {
      // RA 9994 / RA 7277: strip VAT, take 20% off the net, re-apply VAT to
      // the discounted net. Delegated so the POS and the API agree exactly.
      const pwd = this.taxCalc.computePwdScDiscount(grossSubtotal, taxStatus);
      return {
        lines,
        subtotal:        grossSubtotal,
        discountAmount:  pwd.totalSavings,
        vatAmount:       pwd.vatOnDiscounted,
        totalAmount:     pwd.discountedTotal,
        isPwdScDiscount: true,
        taxStatus,
        currency:        'PHP',
      };
    }

    const breakdown = this.taxCalc.computeTaxBreakdown(grossSubtotal, taxStatus);
    return {
      lines,
      subtotal:        grossSubtotal,
      discountAmount:  0,
      vatAmount:       breakdown.vatAmount,
      totalAmount:     breakdown.totalAmount,
      isPwdScDiscount: false,
      taxStatus,
      currency:        'PHP',
    };
  }
}
