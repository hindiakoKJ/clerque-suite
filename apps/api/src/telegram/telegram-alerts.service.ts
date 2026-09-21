import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isManilaDay, UsageDay } from '../ingredient-reports/daily-usage';
import { TelegramClient } from './telegram.client';
import { AlertTopic, TelegramLinksService } from './telegram-links.service';
// The notes grammar only (a plain module): no reach into the Procure service.
import { lastPricedLines } from '../procure/procure-notes';
import {
  RequestForAlert, SaleForAlert, boughtMessage, buyListSentMessage, buyListUpdatedMessage, dailyUsageMessage, photoCaption, postedMessage, saleMessage,
} from './messages';

/**
 * The alerts a shop's owners and managers get on Telegram.
 *
 * Called from the moment something really happened -- after a sale has
 * committed, after a purchase step has saved. Every method returns at once
 * with a promise that never rejects; callers do not await it, so a slow or
 * broken Telegram can never slow down or fail a sale or a purchase.
 *
 * Each alert first asks whether anyone in the shop is listening, so a shop
 * with nobody linked pays for one count query and nothing else.
 */
@Injectable()
export class TelegramAlertsService {
  private readonly logger = new Logger('TelegramAlerts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramClient,
    private readonly links: TelegramLinksService,
  ) {}

  saleConfirmed(tenantId: string, orderId: string): Promise<void> {
    return this.fire('sale', tenantId, 'sales', async () => {
      const order = await this.prisma.order.findFirst({
        where:  { id: orderId, tenantId },
        select: {
          orderNumber: true, branchId: true, channel: true, paidAt: true, createdAt: true,
          subtotal: true, discountAmount: true, vatAmount: true, totalAmount: true,
          branch:    { select: { name: true } },
          tenant:    { select: { name: true } },
          createdBy: { select: { name: true } },
          items: {
            orderBy: { id: 'asc' },
            select: {
              productName: true, quantity: true, unitPrice: true, lineTotal: true,
              modifiers: { select: { optionName: true, priceAdjustment: true } },
            },
          },
          payments:  { select: { method: true, amount: true } },
          discounts: { select: { discountType: true } },
        },
      });
      if (!order) return;
      const chats = await this.links.recipients(tenantId, order.branchId, 'sales');
      if (chats.length === 0) return;
      const sale: SaleForAlert = {
        shopName:       order.tenant.name,
        branchName:     order.branch?.name ?? null,
        orderNumber:    order.orderNumber,
        cashierName:    order.createdBy?.name ?? null,
        channel:        order.channel,
        paidAt:         order.paidAt,
        createdAt:      order.createdAt,
        subtotal:       Number(order.subtotal),
        discountAmount: Number(order.discountAmount),
        vatAmount:      Number(order.vatAmount),
        totalAmount:    Number(order.totalAmount),
        items: order.items.map((i) => ({
          name:      i.productName,
          quantity:  Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          lineTotal: Number(i.lineTotal),
          modifiers: i.modifiers.map((m) => ({ name: m.optionName, price: Number(m.priceAdjustment) })),
        })),
        payments:      order.payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
        discountTypes: order.discounts.map((d) => d.discountType),
      };
      const text = saleMessage(sale);
      for (const chat of chats) this.client.sendMessage(chat, text);
    });
  }

  /**
   * `lines` are the ones the buy-list email already worked out, in packs where Clerque knows the pack.
   * `byLabel` names the sender when it is not a person to look up: "Kitchen screen", "Clerque at closing time".
   */
  buyListSent(
    tenantId: string, requestId: string, lines: Array<{ name: string; amount: string }>, sentById: string | null,
    byLabel: string | null = null,
  ): Promise<void> {
    return this.fire('buy list sent', tenantId, 'buying', async () => {
      const req = await this.request(tenantId, requestId);
      if (!req) return;
      const chats = await this.links.recipients(tenantId, req.branchId, 'buying');
      if (chats.length === 0) return;
      const text = buyListSentMessage(req.alert, lines, byLabel ?? await this.nameOf(tenantId, sentById), new Date());
      for (const chat of chats) this.client.sendMessage(chat, text);
    });
  }

  /** A sent list a kitchen or bar screen added to: only the changed lines, in the bell's words. */
  buyListUpdated(tenantId: string, requestId: string, lines: Array<{ name: string; amount: string }>, byLabel: string | null): Promise<void> {
    return this.fire('buy list updated', tenantId, 'buying', async () => {
      const req = await this.request(tenantId, requestId);
      if (!req) return;
      const chats = await this.links.recipients(tenantId, req.branchId, 'buying');
      if (chats.length === 0) return;
      const text = buyListUpdatedMessage(req.alert, lines, byLabel, new Date());
      for (const chat of chats) this.client.sendMessage(chat, text);
    });
  }

  /** `added`: a later trip onto a request already bought -- what this recording added. */
  bought(tenantId: string, requestId: string, recordedById: string | null, added: { items: number; value: number } | null = null): Promise<void> {
    return this.fire('bought', tenantId, 'buying', async () => {
      const req = await this.request(tenantId, requestId);
      if (!req) return;
      const chats = await this.links.recipients(tenantId, req.branchId, 'buying');
      if (chats.length === 0) return;
      const text = boughtMessage(req.alert, await this.nameOf(tenantId, recordedById), new Date(), added);
      for (const chat of chats) this.client.sendMessage(chat, text);
    });
  }

  /** The photo exactly as it was filed: the bytes are already in memory at the call. */
  purchasePhoto(tenantId: string, requestId: string, photo: Buffer, mime: string, label: string, filedById: string | null): Promise<void> {
    return this.fire('purchase photo', tenantId, 'buying', async () => {
      const req = await this.request(tenantId, requestId);
      if (!req) return;
      const chats = await this.links.recipients(tenantId, req.branchId, 'buying');
      if (chats.length === 0) return;
      const caption = photoCaption(req.alert, label, await this.nameOf(tenantId, filedById), new Date());
      for (const chat of chats) this.client.sendPhoto(chat, photo, mime, caption, `${caption}\n(The photo could not be sent this time. It is filed with the request in Clerque.)`);
    });
  }

  postedToStock(tenantId: string, requestId: string, postedById: string | null): Promise<void> {
    return this.fire('posted to stock', tenantId, 'buying', async () => {
      const req = await this.request(tenantId, requestId);
      if (!req) return;
      const chats = await this.links.recipients(tenantId, req.branchId, 'buying');
      if (chats.length === 0) return;
      const text = postedMessage(req.alert, await this.nameOf(tenantId, postedById), new Date());
      for (const chat of chats) this.client.sendMessage(chat, text);
    });
  }

  /**
   * The ingredient usage sheet for one branch, sent by the end-of-day job a
   * little after closing. `usage` is the very reading the job built the bell
   * notification from -- not read again here, so the phone and the bell show
   * the same numbers even when a sale lands in between. `usage.day` names the
   * sheet (YYYY-MM-DD, Manila); `lateSales` counts sales on no sheet.
   *
   * On the buying switch: what was used today is what gets bought tomorrow,
   * and a new switch would need a new column and a new setting on the
   * Telegram page.
   */
  dailyUsage(tenantId: string, branchId: string, usage: UsageDay, lateSales: number): Promise<void> {
    return this.fire('end-of-day usage', tenantId, 'buying', async () => {
      if (!isManilaDay(usage.day)) throw new Error(`"${usage.day}" is not a real day written YYYY-MM-DD`);
      const chats = await this.links.recipients(tenantId, branchId, 'buying');
      if (chats.length === 0) return;
      const branch = await this.prisma.branch.findFirst({
        where:  { id: branchId, tenantId },
        select: { name: true, tenant: { select: { name: true } } },
      });
      if (!branch) return;
      const text = dailyUsageMessage({
        shopName:       branch.tenant.name,
        branchName:     branch.name,
        day:            usage.day,
        rows:           usage.rows,
        totalValue:     usage.totals.value,
        stillBeingMade: usage.stillBeingMade,
        lateSales,
      });
      for (const chat of chats) this.client.sendMessage(chat, text);
    });
  }

  private async fire(what: string, tenantId: string, topic: AlertTopic, work: () => Promise<void>): Promise<void> {
    if (!this.client.enabled) return;
    try {
      if (!(await this.links.anyoneListening(tenantId, topic))) return;
      await work();
    } catch (err) {
      // The sale or purchase is saved; only the alert about it failed.
      this.logger.warn(`Could not send the ${what} alert: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async request(tenantId: string, requestId: string): Promise<{ branchId: string; alert: RequestForAlert } | null> {
    const req = await this.prisma.purchaseRequest.findFirst({
      where:  { id: requestId, tenantId },
      select: {
        requestNumber: true, branchId: true, notes: true,
        branch: { select: { name: true } },
        tenant: { select: { name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            id: true,
            packsBought: true, packSize: true, packCost: true, receivedAt: true,
            rawMaterial: { select: { name: true, unit: true } },
          },
        },
      },
    });
    if (!req) return null;
    // Lines staff recorded that carry last time's price, for the owner to check.
    const lastPriced = lastPricedLines(req.notes);
    return {
      branchId: req.branchId,
      alert: {
        shopName:      req.tenant.name,
        branchName:    req.branch?.name ?? null,
        requestNumber: req.requestNumber,
        lines: req.lines.map((l) => ({
          name:        l.rawMaterial.name,
          unit:        l.rawMaterial.unit,
          packsBought: l.packsBought == null ? null : Number(l.packsBought),
          packSize:    l.packSize == null ? null : Number(l.packSize),
          packCost:    l.packCost == null ? null : Number(l.packCost),
          received:    l.receivedAt != null,
          lastPrice:   lastPriced.has(l.id),
        })),
      },
    };
  }

  private async nameOf(tenantId: string, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { name: true } });
    return u?.name ?? null;
  }
}
