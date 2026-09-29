import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Start a new shop from an existing one's setup.
 *
 * The first real shop is usually set up twice: once on a test account while
 * the menu, the recipes and the costs are worked out, and once for real. The
 * second time should be one step, not a week of re-typing. This copies
 * everything that describes HOW the shop runs, and nothing that happened in it:
 *
 *   copied   stations, categories (and which screen each goes to), units,
 *            products with their prices, photos, sizes and add-ons, the
 *            ingredients with their costs and reorder levels, every recipe
 *            (per product, per size, per add-on, and the preps'), discount
 *            types, price lists, promotions, the receipt-reader's memory of
 *            what each printed line is, the reorder point on shelf goods,
 *            the branch's closing time, and the shop's running settings
 *            (receipt notes and logo, who sees costs, ledger mode, stock and
 *            costing modes, sale-when-out, returns rule, self clock-in)
 *   not      sales, stock on hand, purchases, journal entries, staff,
 *            customers, vendors, and the shop's identity (name, TIN, tax
 *            status, plan) -- those are the new shop's own
 *
 * Only into an EMPTY shop: one with no products, no ingredients, no
 * categories and no sales. Copying on top of a live menu would double it,
 * and there is no way to tell which half is meant.
 *
 * One transaction: it all lands, or none of it does.
 */

type Tx = Prisma.TransactionClient;

export interface CopySetupResult {
  copied: Record<string, number>;
}

/** Tenant columns that say how a shop RUNS, not who it is. */
const RUNNING_SETTINGS = [
  'businessType', 'receiptHeaderNote', 'receiptFooterNote', 'receiptLogoUrl',
  'allowSelfClockIn', 'returnsOwnerOnly', 'allowSaleWhenOutOfStock', 'showPurchaseCostsToStaff',
  'ledgerMode', 'inventoryMode', 'valuationMethod', 'coffeeShopTier', 'overheadRatePerUnit', 'hasCustomerDisplay',
] as const;

/** A row, minus what belongs to the source: its id, its tenant, its timestamps. */
function fields(row: Record<string, unknown>, drop: string[] = []): Record<string, unknown> {
  const out = { ...row };
  for (const k of ['id', 'tenantId', 'createdAt', 'updatedAt', ...drop]) delete out[k];
  return out;
}

/** The id a mapped row got in the new shop, or null when the source had none. */
function mapped(map: Map<string, string>, id: unknown): string | null {
  return typeof id === 'string' && id ? (map.get(id) ?? null) : null;
}

export async function copyShopSetup(tx: Tx, fromTenantId: string, toTenantId: string): Promise<CopySetupResult> {
  if (fromTenantId === toTenantId) throw new BadRequestException('A shop cannot be copied onto itself.');
  const [from, to] = await Promise.all([
    tx.tenant.findUnique({ where: { id: fromTenantId } }),
    tx.tenant.findUnique({ where: { id: toTenantId }, select: { id: true } }),
  ]);
  if (!from) throw new NotFoundException('The shop to copy from was not found.');
  if (!to) throw new NotFoundException('The new shop was not found.');

  const [products, materials, categories, orders] = await Promise.all([
    tx.product.count({ where: { tenantId: toTenantId } }),
    tx.rawMaterial.count({ where: { tenantId: toTenantId } }),
    tx.category.count({ where: { tenantId: toTenantId } }),
    tx.order.count({ where: { tenantId: toTenantId } }),
  ]);
  if (products + materials + categories + orders > 0) {
    throw new ConflictException(
      'The new shop already has a menu, ingredients or sales. Copy only into a new, empty shop, '
      + 'so nothing ends up on the menu twice.',
    );
  }
  const branch = await tx.branch.findFirst({
    where: { tenantId: toTenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, closesAt: true },
  });
  if (!branch) throw new BadRequestException('The new shop has no branch yet. Create one first.');

  const copied: Record<string, number> = {};
  const count = (k: string, n: number) => { copied[k] = (copied[k] ?? 0) + n; };

  // ── stations, units, categories ─────────────────────────────────────────
  const stationMap = new Map<string, string>();
  for (const s of await tx.station.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.station.create({
      data: {
        ...(fields(s, ['printerId', 'branchId']) as Prisma.StationUncheckedCreateInput),
        tenantId: toTenantId,
        // A station belongs to a branch's kitchen or bar; the new shop's is its first branch. Printers are per device.
        branchId: s.branchId ? branch.id : null,
        printerId: null,
      },
    });
    stationMap.set(s.id, made.id);
  }
  count('stations', stationMap.size);

  const unitMap = new Map<string, string>();
  for (const u of await tx.unitOfMeasure.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.unitOfMeasure.create({
      data: { ...(fields(u) as Prisma.UnitOfMeasureUncheckedCreateInput), tenantId: toTenantId },
    });
    unitMap.set(u.id, made.id);
  }
  count('units', unitMap.size);

  const categoryMap = new Map<string, string>();
  for (const c of await tx.category.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.category.create({
      data: {
        ...(fields(c, ['stationId']) as Prisma.CategoryUncheckedCreateInput),
        tenantId: toTenantId,
        stationId: mapped(stationMap, c.stationId),
      },
    });
    categoryMap.set(c.id, made.id);
  }
  count('categories', categoryMap.size);

  // ── photos the menu and the receipt point at ────────────────────────────
  /*
    A product photo (and the receipt logo) is a ProductPhoto row of the source
    shop, named in the URL by its id. The URL would keep working, but the row
    goes with the source shop the day it is removed; so each photo in use is
    copied to the new shop and the URL rewritten to the copy.
  */
  const sourceProducts = await tx.product.findMany({ where: { tenantId: fromTenantId } });
  const urls = [...sourceProducts.map((p) => p.imageUrl), from.receiptLogoUrl].filter((u): u is string => !!u);
  const photos = urls.length === 0 ? [] : await tx.productPhoto.findMany({
    where: { tenantId: fromTenantId },
    select: { id: true, mimeType: true, byteSize: true, originalName: true },
  });
  const photoMap = new Map<string, string>();
  for (const ph of photos) {
    if (!urls.some((u) => u.includes(ph.id))) continue;
    const bytes = await tx.productPhoto.findUnique({ where: { id: ph.id }, select: { data: true } });
    if (!bytes) continue;
    const made = await tx.productPhoto.create({
      data: { tenantId: toTenantId, mimeType: ph.mimeType, byteSize: ph.byteSize, data: bytes.data, originalName: ph.originalName },
      select: { id: true },
    });
    photoMap.set(ph.id, made.id);
  }
  const rewrite = (url: string | null): string | null => {
    if (!url) return url;
    let out = url;
    for (const [oldId, newId] of photoMap) out = out.split(oldId).join(newId);
    return out;
  };
  count('photos', photoMap.size);

  // ── products, sizes ─────────────────────────────────────────────────────
  const productMap = new Map<string, string>();
  for (const p of sourceProducts) {
    const made = await tx.product.create({
      data: {
        ...(fields(p, ['categoryId', 'unitOfMeasureId', 'imageUrl']) as Prisma.ProductUncheckedCreateInput),
        tenantId: toTenantId,
        categoryId: mapped(categoryMap, p.categoryId),
        unitOfMeasureId: mapped(unitMap, p.unitOfMeasureId),
        imageUrl: rewrite(p.imageUrl),
      },
    });
    productMap.set(p.id, made.id);
    // Photos are attached to their product as well as named in its URL.
  }
  for (const [oldPhoto, newPhoto] of photoMap) {
    const owner = await tx.productPhoto.findUnique({ where: { id: oldPhoto }, select: { productId: true } });
    const productId = mapped(productMap, owner?.productId);
    if (productId) await tx.productPhoto.update({ where: { id: newPhoto }, data: { productId } });
  }
  count('products', productMap.size);

  const variantMap = new Map<string, string>();
  for (const v of await tx.productVariant.findMany({ where: { product: { tenantId: fromTenantId } } })) {
    const productId = mapped(productMap, v.productId);
    if (!productId) continue;
    const made = await tx.productVariant.create({
      data: { ...(fields(v, ['productId']) as Prisma.ProductVariantUncheckedCreateInput), productId },
    });
    variantMap.set(v.id, made.id);
  }
  count('sizes', variantMap.size);

  // ── ingredients and every recipe ────────────────────────────────────────
  const materialMap = new Map<string, string>();
  for (const r of await tx.rawMaterial.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.rawMaterial.create({
      data: { ...(fields(r) as Prisma.RawMaterialUncheckedCreateInput), tenantId: toTenantId },
    });
    materialMap.set(r.id, made.id);
  }
  count('ingredients', materialMap.size);

  const bom = (await tx.bomItem.findMany({ where: { product: { tenantId: fromTenantId } } }))
    .map((b) => ({ productId: mapped(productMap, b.productId), rawMaterialId: mapped(materialMap, b.rawMaterialId), quantity: b.quantity }))
    .filter((b): b is { productId: string; rawMaterialId: string; quantity: Prisma.Decimal } => !!b.productId && !!b.rawMaterialId);
  if (bom.length) await tx.bomItem.createMany({ data: bom });
  count('recipeLines', bom.length);

  const variantBom = (await tx.variantBomItem.findMany({ where: { variant: { product: { tenantId: fromTenantId } } } }))
    .map((b) => ({ variantId: mapped(variantMap, b.variantId), rawMaterialId: mapped(materialMap, b.rawMaterialId), quantity: b.quantity }))
    .filter((b): b is { variantId: string; rawMaterialId: string; quantity: Prisma.Decimal } => !!b.variantId && !!b.rawMaterialId);
  if (variantBom.length) await tx.variantBomItem.createMany({ data: variantBom });
  count('sizeRecipeLines', variantBom.length);

  const preps = (await tx.subRecipeItem.findMany({ where: { parent: { tenantId: fromTenantId } } }))
    .map((s) => ({ parentRawMaterialId: mapped(materialMap, s.parentRawMaterialId), rawMaterialId: mapped(materialMap, s.rawMaterialId), quantity: s.quantity }))
    .filter((s): s is { parentRawMaterialId: string; rawMaterialId: string; quantity: Prisma.Decimal } => !!s.parentRawMaterialId && !!s.rawMaterialId);
  if (preps.length) await tx.subRecipeItem.createMany({ data: preps });
  count('prepRecipeLines', preps.length);

  // ── add-ons ─────────────────────────────────────────────────────────────
  const groupMap = new Map<string, string>();
  for (const g of await tx.modifierGroup.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.modifierGroup.create({
      data: {
        ...(fields(g, ['categoryId']) as Prisma.ModifierGroupUncheckedCreateInput),
        tenantId: toTenantId,
        categoryId: mapped(categoryMap, g.categoryId),
      },
    });
    groupMap.set(g.id, made.id);
  }
  count('addOnGroups', groupMap.size);

  const optionMap = new Map<string, string>();
  for (const o of await tx.modifierOption.findMany({ where: { group: { tenantId: fromTenantId } } })) {
    const modifierGroupId = mapped(groupMap, o.modifierGroupId);
    if (!modifierGroupId) continue;
    const made = await tx.modifierOption.create({
      data: { ...(fields(o, ['modifierGroupId']) as Prisma.ModifierOptionUncheckedCreateInput), modifierGroupId },
    });
    optionMap.set(o.id, made.id);
  }
  count('addOnOptions', optionMap.size);

  const links = (await tx.productModifierGroup.findMany({ where: { product: { tenantId: fromTenantId } } }))
    .map((l) => ({ productId: mapped(productMap, l.productId), modifierGroupId: mapped(groupMap, l.modifierGroupId), sortOrder: l.sortOrder }))
    .filter((l): l is { productId: string; modifierGroupId: string; sortOrder: number } => !!l.productId && !!l.modifierGroupId);
  if (links.length) await tx.productModifierGroup.createMany({ data: links });
  count('addOnLinks', links.length);

  const optionIngredients = (await tx.modifierOptionIngredient.findMany({ where: { option: { group: { tenantId: fromTenantId } } } }))
    .map((i) => ({ modifierOptionId: mapped(optionMap, i.modifierOptionId), rawMaterialId: mapped(materialMap, i.rawMaterialId), quantity: i.quantity, unit: i.unit }))
    .filter((i): i is { modifierOptionId: string; rawMaterialId: string; quantity: Prisma.Decimal; unit: string } => !!i.modifierOptionId && !!i.rawMaterialId);
  if (optionIngredients.length) await tx.modifierOptionIngredient.createMany({ data: optionIngredients });
  count('addOnRecipeLines', optionIngredients.length);

  // ── discounts, price lists, promotions ──────────────────────────────────
  const discounts = (await tx.discountTypeConfig.findMany({ where: { tenantId: fromTenantId } }))
    .map((d) => ({ ...(fields(d) as Prisma.DiscountTypeConfigCreateManyInput), tenantId: toTenantId }));
  if (discounts.length) await tx.discountTypeConfig.createMany({ data: discounts });
  count('discountTypes', discounts.length);

  const listMap = new Map<string, string>();
  for (const l of await tx.priceList.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.priceList.create({ data: { ...(fields(l) as Prisma.PriceListUncheckedCreateInput), tenantId: toTenantId } });
    listMap.set(l.id, made.id);
  }
  const listItems = (await tx.priceListItem.findMany({ where: { priceList: { tenantId: fromTenantId } } }))
    .map((i) => ({ priceListId: mapped(listMap, i.priceListId), productId: mapped(productMap, i.productId), unitPrice: i.unitPrice, minQuantity: i.minQuantity }))
    .filter((i): i is { priceListId: string; productId: string; unitPrice: Prisma.Decimal; minQuantity: Prisma.Decimal | null } => !!i.priceListId && !!i.productId);
  if (listItems.length) await tx.priceListItem.createMany({ data: listItems });
  count('priceLists', listMap.size);

  const promoMap = new Map<string, string>();
  for (const pr of await tx.promotion.findMany({ where: { tenantId: fromTenantId } })) {
    const made = await tx.promotion.create({ data: { ...(fields(pr) as Prisma.PromotionUncheckedCreateInput), tenantId: toTenantId } });
    promoMap.set(pr.id, made.id);
  }
  const promoItems = (await tx.promotionProduct.findMany({ where: { promotion: { tenantId: fromTenantId } } }))
    .map((i) => ({ promotionId: mapped(promoMap, i.promotionId), productId: mapped(productMap, i.productId) }))
    .filter((i): i is { promotionId: string; productId: string } => !!i.promotionId && !!i.productId);
  if (promoItems.length) await tx.promotionProduct.createMany({ data: promoItems });
  count('promotions', promoMap.size);

  // ── the reorder point on shelf goods, and the reader's memory ───────────
  /*
    Shelf goods (bottled water, a pastry bought in) keep their reorder point
    on the per-branch stock row. The new shop starts with none of them on the
    shelf, so the row is made at zero with the same point; the count on day
    one fills in what is really there.
  */
  const seenProduct = new Set<string>();
  const shelf: Prisma.InventoryItemCreateManyInput[] = [];
  for (const it of await tx.inventoryItem.findMany({ where: { tenantId: fromTenantId, lowStockAlert: { not: null } } })) {
    const productId = mapped(productMap, it.productId);
    if (!productId || seenProduct.has(productId)) continue;
    seenProduct.add(productId);
    shelf.push({ tenantId: toTenantId, branchId: branch.id, productId, quantity: new Prisma.Decimal(0), lowStockAlert: it.lowStockAlert, lotsTracked: it.lotsTracked });
  }
  if (shelf.length) await tx.inventoryItem.createMany({ data: shelf });
  count('shelfReorderPoints', shelf.length);

  const aliases = (await tx.receiptAlias.findMany({ where: { tenantId: fromTenantId } }))
    .map((a) => ({ ...(fields(a, ['rawMaterialId', 'createdById']) as Prisma.ReceiptAliasCreateManyInput), tenantId: toTenantId, rawMaterialId: mapped(materialMap, a.rawMaterialId) ?? '' }))
    .filter((a) => !!a.rawMaterialId);
  if (aliases.length) await tx.receiptAlias.createMany({ data: aliases });
  count('receiptMemories', aliases.length);

  // ── how the shop runs ───────────────────────────────────────────────────
  const settings: Record<string, unknown> = {};
  for (const k of RUNNING_SETTINGS) settings[k] = (from as Record<string, unknown>)[k];
  settings.receiptLogoUrl = rewrite(from.receiptLogoUrl);
  await tx.tenant.update({ where: { id: toTenantId }, data: settings as Prisma.TenantUpdateInput });

  // The branch closing time decides when the day closes; keep the new shop's own if it already set one.
  const sourceBranch = await tx.branch.findFirst({
    where: { tenantId: fromTenantId, closesAt: { not: null } }, orderBy: { createdAt: 'asc' }, select: { closesAt: true },
  });
  if (!branch.closesAt && sourceBranch?.closesAt) {
    await tx.branch.update({ where: { id: branch.id }, data: { closesAt: sourceBranch.closesAt } });
  }

  return { copied };
}
