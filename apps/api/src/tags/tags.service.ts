import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InventoryLogType, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { AuditService } from '../audit/audit.service';
import { purchaseCostsVisibleTo } from '../procure/cost-visibility';
import {
  formatTagNumber, isTagNumber, partKind, readDetails, tagState, whyNotSellable, writeDetails,
  type TagDetails, type TagState,
} from './tag-rules';

/**
 * Clerque Inventory, Phase 1: tags (tasks/inventory-phase1-api.md).
 *
 * A tag is a SerializedUnit whose serialNumber is a printed 6-digit label
 * number. The owner reserves label numbers, staff tag parts with them and
 * photograph them, the owner costs each tag (which puts it in stock and in the
 * books), and Counter sells it once, by its number (orders.service.ts).
 */

/** Label runs are kept in the audit log (no new table in Phase 1). */
const LABEL_RUN = 'TAG_LABEL_RUN';
const PHOTO_ENTITY = 'SerializedUnit';
const MAX_RUN = 500;

export interface TagView {
  id: string;
  number: string;
  status: TagState;
  productId: string;
  productName: string;
  sku: string | null;
  price: number;
  branchId: string;
  engineNumber: string | null;
  chassisNumber: string | null;
  notes: string | null;
  photos: { id: string; url: string }[];
  cost?: number | null;
  sellable: boolean;
  notSellableReason: string | null;
  soldOrderId: string | null;
  createdAt: Date;
}

export interface CreateTagInput {
  number: string;
  productId: string;
  branchId: string;
  engineNumber?: string;
  chassisNumber?: string;
  notes?: string;
}

export type PaidFrom = 'OWNER_FUNDED' | 'BANK' | 'CASH';

const TAG_SELECT = {
  id: true, serialNumber: true, status: true, acquiredCost: true, conditionNotes: true,
  branchId: true, productId: true, soldOrderId: true, createdAt: true,
  product: { select: { name: true, sku: true, price: true } },
} satisfies Prisma.SerializedUnitSelect;

type TagRow = Prisma.SerializedUnitGetPayload<{ select: typeof TAG_SELECT }>;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  // ── Label runs ──────────────────────────────────────────────────────────

  /** The highest number this shop ever printed or used (0 when none). */
  private async highestNumber(db: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const runs = await db.auditLog.findMany({
      where: { tenantId, entityType: LABEL_RUN },
      select: { after: true },
    });
    let top = 0;
    for (const r of runs) {
      const to = Number((r.after as { to?: string } | null)?.to);
      if (Number.isFinite(to) && to > top) top = to;
    }
    const used = await db.serializedUnit.findMany({ where: { tenantId }, select: { serialNumber: true } });
    for (const u of used) {
      if (isTagNumber(u.serialNumber)) top = Math.max(top, Number(u.serialNumber));
    }
    return top;
  }

  async reserveLabels(tenantId: string, userId: string, count: number) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > MAX_RUN) {
      throw new BadRequestException(`Print between 1 and ${MAX_RUN} labels at a time.`);
    }
    return this.prisma.$transaction(async (tx) => {
      // One run at a time per shop, so two people never get the same numbers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tag-labels:' + tenantId}))`;
      const start = (await this.highestNumber(tx, tenantId)) + 1;
      const end = start + n - 1;
      if (end > 999_999) throw new BadRequestException('This shop has used every 6-digit label number.');
      const from = formatTagNumber(start);
      const to = formatTagNumber(end);
      await tx.auditLog.create({
        data: {
          tenantId, action: 'SETTING_CHANGED', entityType: LABEL_RUN, entityId: `${from}-${to}`,
          after: { from, to, count: n }, description: `Printed tag labels ${from} to ${to}`, performedBy: userId,
        },
      });
      const numbers: string[] = [];
      for (let i = start; i <= end; i++) numbers.push(formatTagNumber(i));
      return { from, to, numbers };
    });
  }

  async listRuns(tenantId: string) {
    const runs = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: LABEL_RUN },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { after: true, createdAt: true, performedBy: true },
    });
    const ids = [...new Set(runs.map((r) => r.performedBy).filter((x): x is string => !!x))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return runs.map((r) => {
      const a = (r.after ?? {}) as { from?: string; to?: string; count?: number };
      return { from: a.from, to: a.to, count: a.count, createdAt: r.createdAt, createdByName: r.performedBy ? nameOf.get(r.performedBy) ?? null : null };
    });
  }

  /** Is this number inside a label run this shop printed? */
  private async isPrinted(tenantId: string, number: string): Promise<boolean> {
    const n = Number(number);
    const runs = await this.prisma.auditLog.findMany({ where: { tenantId, entityType: LABEL_RUN }, select: { after: true } });
    return runs.some((r) => {
      const a = (r.after ?? {}) as { from?: string; to?: string };
      return Number(a.from) <= n && n <= Number(a.to);
    });
  }

  // ── Tagging a part ──────────────────────────────────────────────────────

  async createTag(tenantId: string, userId: string, input: CreateTagInput) {
    const number = String(input.number ?? '').trim();
    if (!isTagNumber(number)) throw new BadRequestException('The tag number is the 6 digits on the label.');
    if (!input.productId || !input.branchId) throw new BadRequestException('Pick the product and the branch.');

    const [product, branch] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: input.productId, tenantId }, select: { id: true, sku: true, name: true } }),
      this.prisma.branch.findFirst({ where: { id: input.branchId, tenantId }, select: { id: true } }),
    ]);
    if (!product) throw new NotFoundException('Product not found.');
    if (!branch) throw new NotFoundException('Branch not found.');

    const kind = partKind(product.sku);
    if (kind === 'ENGINE' && !input.engineNumber?.trim()) {
      throw new BadRequestException('Type the engine number stamped on the engine.');
    }
    if ((kind === 'HALF_CUT' || kind === 'FRAME_PIECE') && !input.chassisNumber?.trim()) {
      throw new BadRequestException('Type the chassis number stamped on the piece.');
    }
    if (!(await this.isPrinted(tenantId, number))) {
      throw new BadRequestException(`Label ${number} was never printed by this shop. Use a label from a printed run.`);
    }

    try {
      const row = await this.prisma.serializedUnit.create({
        data: {
          tenantId, branchId: input.branchId, productId: input.productId, serialNumber: number,
          status: 'IN_STOCK', acquiredCost: null,
          conditionNotes: writeDetails({ engineNumber: input.engineNumber, chassisNumber: input.chassisNumber, notes: input.notes }),
        },
        select: TAG_SELECT,
      });
      await this.audit.log({
        tenantId, action: 'SETTING_CHANGED', entityType: 'TAG', entityId: row.id,
        after: { number, productId: product.id, branchId: input.branchId }, description: `Tagged ${product.name} as ${number}`,
        performedBy: userId,
      });
      return this.view(row, [], true);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Label ${number} is already on another part.`);
      }
      throw e;
    }
  }

  async addPhoto(
    tenantId: string, userId: string, role: string, tagId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No photo was received.');
    const tag = await this.prisma.serializedUnit.findFirst({ where: { id: tagId, tenantId }, select: { id: true, acquiredCost: true, serialNumber: true } });
    if (!tag) throw new NotFoundException('Tag not found.');
    // Once the owner has costed a part from its photos, only he may add to them.
    if (tag.acquiredCost != null && role !== 'BUSINESS_OWNER') {
      throw new ForbiddenException('This part is already costed. Only the owner can add photos now.');
    }
    const doc = await this.documents.uploadBuffer(
      tenantId, PHOTO_ENTITY, tag.id, file.buffer, file.mimetype, file.originalname || `tag-${tag.serialNumber}.jpg`,
      `Tag ${tag.serialNumber}`, userId,
    );
    return { id: doc.id, url: `/tags/photos/${doc.id}` };
  }

  async servePhoto(tenantId: string, documentId: string, res: Response, role: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, tenantId, entityType: PHOTO_ENTITY }, select: { id: true } });
    if (!doc) throw new NotFoundException('Photo not found.');
    await this.documents.serve(tenantId, documentId, res, role);
  }

  // ── Costing: the part goes into stock and the books ─────────────────────

  async costTag(tenantId: string, userId: string, tagId: string, cost: number, paidFrom: PaidFrom) {
    const c = Number(cost);
    if (!Number.isFinite(c) || c < 0) throw new BadRequestException('The cost must be a number, zero or more.');
    if (!['OWNER_FUNDED', 'BANK', 'CASH'].includes(paidFrom)) {
      throw new BadRequestException('Say where the money came from: the owner, the bank, or the cash drawer.');
    }
    const tag = await this.prisma.serializedUnit.findFirst({ where: { id: tagId, tenantId }, select: TAG_SELECT });
    if (!tag) throw new NotFoundException('Tag not found.');
    if (tagState(tag.status, tag.acquiredCost) !== 'WAITING_FOR_COST') {
      throw new ConflictException(`Tag ${tag.serialNumber} is already costed.`);
    }
    const photos = await this.prisma.document.count({ where: { tenantId, entityType: PHOTO_ENTITY, entityId: tag.id } });
    if (photos < 1) throw new BadRequestException(`Tag ${tag.serialNumber} has no photo. Cost it after you have seen the part.`);

    const unitCost = Math.round(c * 100) / 100;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.serializedUnit.updateMany({
        where: { id: tag.id, tenantId, status: 'IN_STOCK', acquiredCost: null },
        data: { acquiredCost: new Prisma.Decimal(unitCost), acquiredAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException(`Tag ${tag.serialNumber} is already costed.`);

      // A stock-in of one at the tag's own cost, the same shape inventory.adjust
      // writes, so the shelf count, the average cost and the books stay together.
      const existing = await tx.inventoryItem.findUnique({
        where: { branchId_productId: { branchId: tag.branchId, productId: tag.productId } },
      });
      const before = existing ? Number(existing.quantity) : 0;
      const oldAvg = existing?.avgCost != null ? Number(existing.avgCost) : null;
      const after = before + 1;
      const newAvg = before <= 0 || oldAvg == null ? unitCost : (before * oldAvg + unitCost) / after;
      await tx.inventoryItem.upsert({
        where: { branchId_productId: { branchId: tag.branchId, productId: tag.productId } },
        create: { tenantId, branchId: tag.branchId, productId: tag.productId, quantity: new Prisma.Decimal(after), avgCost: new Prisma.Decimal(newAvg) },
        update: { quantity: new Prisma.Decimal(after), avgCost: new Prisma.Decimal(newAvg) },
      });
      const reason = `Tag ${tag.serialNumber} costed`;
      await tx.inventoryLog.create({
        data: {
          tenantId, branchId: tag.branchId, productId: tag.productId, type: InventoryLogType.STOCK_IN,
          quantity: new Prisma.Decimal(1), quantityBefore: new Prisma.Decimal(before), quantityAfter: new Prisma.Decimal(after),
          reason, referenceId: tag.id, createdById: userId,
        },
      });
      await tx.accountingEvent.create({
        data: {
          tenantId, type: 'INVENTORY_ADJUSTMENT', status: 'PENDING',
          payload: {
            productId: tag.productId, productName: tag.product.name, branchId: tag.branchId,
            adjustmentType: 'STOCK_IN', quantity: 1, quantityBefore: before, quantityAfter: after,
            costPrice: unitCost, totalValue: unitCost, reason, paymentMethod: paidFrom,
          },
        },
      });
    });
    const fresh = await this.prisma.serializedUnit.findFirst({ where: { id: tag.id, tenantId }, select: TAG_SELECT });
    return this.view(fresh!, await this.photosOf(tenantId, [tag.id]).then((m) => m.get(tag.id) ?? []), true);
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  private async photosOf(tenantId: string, ids: string[]) {
    const docs = ids.length
      ? await this.prisma.document.findMany({
          where: { tenantId, entityType: PHOTO_ENTITY, entityId: { in: ids } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, entityId: true },
        })
      : [];
    const m = new Map<string, { id: string; url: string }[]>();
    for (const d of docs) {
      const list = m.get(d.entityId) ?? [];
      list.push({ id: d.id, url: `/tags/photos/${d.id}` });
      m.set(d.entityId, list);
    }
    return m;
  }

  view(t: TagRow, photos: { id: string; url: string }[], showCost: boolean, saleBranchId?: string | null): TagView {
    const d: TagDetails = readDetails(t.conditionNotes);
    const reason = whyNotSellable(
      { status: t.status, acquiredCost: t.acquiredCost, branchId: t.branchId, photoCount: photos.length },
      saleBranchId,
    );
    return {
      id: t.id,
      number: t.serialNumber,
      status: tagState(t.status, t.acquiredCost),
      productId: t.productId,
      productName: t.product.name,
      sku: t.product.sku,
      price: Number(t.product.price),
      branchId: t.branchId,
      engineNumber: d.engineNumber ?? null,
      chassisNumber: d.chassisNumber ?? null,
      notes: d.notes ?? null,
      photos,
      ...(showCost ? { cost: t.acquiredCost != null ? Number(t.acquiredCost) : null } : {}),
      sellable: reason === null,
      notSellableReason: reason,
      soldOrderId: t.soldOrderId,
      createdAt: t.createdAt,
    };
  }

  async list(tenantId: string, role: string, q: { status?: string; branchId?: string; q?: string }) {
    const where: Prisma.SerializedUnitWhereInput = { tenantId };
    if (q.branchId) where.branchId = q.branchId;
    switch (q.status) {
      case 'WAITING_FOR_COST': where.status = 'IN_STOCK'; where.acquiredCost = null; break;
      case 'IN_STOCK': where.status = 'IN_STOCK'; where.acquiredCost = { not: null }; break;
      case 'SOLD': where.status = 'SOLD'; break;
      case 'RETIRED': where.status = 'RETIRED'; break;
      default: break;
    }
    const search = q.q?.trim();
    if (search) {
      where.OR = [
        { serialNumber: { contains: search } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { product: { sku: { contains: search, mode: 'insensitive' } } },
        { conditionNotes: { contains: search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.serializedUnit.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500, select: TAG_SELECT });
    const [photos, showCost] = await Promise.all([
      this.photosOf(tenantId, rows.map((r) => r.id)),
      purchaseCostsVisibleTo(this.prisma, tenantId, role),
    ]);
    return rows.map((r) => this.view(r, photos.get(r.id) ?? [], showCost));
  }

  /**
   * Whatever someone typed or scanned. A 6-digit number is a tag first; then
   * the product's barcode or SKU. Staff get one exact match, never a list.
   */
  async lookup(tenantId: string, role: string, code: string, branchId?: string) {
    const c = String(code ?? '').trim();
    if (!c) return { kind: 'NONE' as const };
    if (isTagNumber(c)) {
      const tag = await this.prisma.serializedUnit.findFirst({ where: { tenantId, serialNumber: c }, select: TAG_SELECT });
      if (tag) {
        const [photos, showCost] = await Promise.all([
          this.photosOf(tenantId, [tag.id]),
          purchaseCostsVisibleTo(this.prisma, tenantId, role),
        ]);
        return { kind: 'TAG' as const, tag: this.view(tag, photos.get(tag.id) ?? [], showCost, branchId ?? null) };
      }
    }
    const product = await this.prisma.product.findFirst({
      where: { tenantId, isActive: true, OR: [{ barcode: c }, { sku: c }] },
      select: { id: true, name: true, sku: true, barcode: true, price: true },
    });
    if (product) return { kind: 'PRODUCT' as const, product: { ...product, price: Number(product.price) } };
    return { kind: 'NONE' as const };
  }
}
