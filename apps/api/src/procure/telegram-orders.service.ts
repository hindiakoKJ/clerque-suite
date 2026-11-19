import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramClient } from '../telegram/telegram.client';
import type { OrderDesk, OrderingPerson, TgCallback } from '../telegram/telegram-links.service';
import { TelegramLinksService } from '../telegram/telegram-links.service';
import { escapeHtml } from '../telegram/messages';
import {
  ChecklistItem, MAX_ITEMS, applyTap, buildKeyboard, checklistText, orderItems, readCounts, readNeed, readTap,
} from '../telegram/order-checklist';
import { RequestContext, SUPPLY_CATEGORIES, StationExtra, StationRequestService } from './station-request.service';

/**
 * Staff order supplies from Telegram (KJ, 2026-11-19).
 *
 * Cleaning materials and other things that never go into a recipe used to be
 * asked for in the group chat, where requests got buried and doubled. Now a
 * staff member sends /order to @ClerqueBot, ticks what is running low, and
 * taps Send. The lines go on the next buy list -- the one the end-of-day job
 * sends the owners -- marked with who asked. There is no approve step: the
 * owner decides how many to actually buy. Receiving stays in Clerque Procure.
 *
 * Staff never log in for this. The owner or a manager hands each one a link
 * (Settings → Telegram alerts → Staff who order supplies), which ties that
 * person's Telegram to their staff record and to nothing else: no alert ever
 * reaches them.
 *
 * Only supplies are on the checklist: kitchen, bar and office supplies.
 * Ingredients stay with the kitchen and bar screens and the forecast, which
 * know what the menu uses. /need adds something not on the list, as a new
 * kitchen supply the owner can sort out later.
 */
@Injectable()
export class TelegramOrdersService implements OrderDesk, OnModuleInit {
  private readonly logger = new Logger(TelegramOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: StationRequestService,
    @Optional() private readonly links?: TelegramLinksService,
    @Optional() private readonly client?: TelegramClient,
  ) {}

  onModuleInit() {
    this.links?.setOrderDesk(this);
  }

  // ── /order ────────────────────────────────────────────────────────────────

  async open(chatId: string, person: OrderingPerson): Promise<void> {
    const branch = await this.branchFor(person);
    if (!branch) {
      this.say(chatId, 'Clerque does not know which branch you work at. Ask the owner to set your branch.');
      return;
    }
    const { items, truncated } = await this.items(person.tenantId, branch.id);
    if (items.length === 0) {
      this.say(chatId, 'No supplies are set up in Clerque yet. Send <code>/need item, how many</code> — for example <code>/need Bleach, 2</code>.');
      return;
    }
    this.client?.sendMessage(chatId, checklistText(person.shopName, branch.multi ? branch.name : null, truncated), buildKeyboard(items, new Map()));
  }

  // ── a tap on the checklist ────────────────────────────────────────────────

  async tap(cb: TgCallback, chatId: string, person: OrderingPerson): Promise<void> {
    const tap = readTap(cb.data);
    const messageId = cb.message?.message_id;
    if (!tap || messageId == null) {
      this.client?.answerCallback(cb.id);
      return;
    }
    if (tap.kind === 'cancel') {
      await this.client?.editMessage(chatId, messageId, 'Cancelled. Nothing was sent.');
      this.client?.answerCallback(cb.id);
      return;
    }
    const branch = await this.branchFor(person);
    if (!branch) {
      this.client?.answerCallback(cb.id, 'Ask the owner to set your branch.');
      return;
    }
    const { items, truncated } = await this.items(person.tenantId, branch.id);
    const known = new Set(items.map((i) => i.id));
    const counts = new Map([...readCounts(cb.message?.reply_markup)].filter(([id]) => known.has(id)));

    if (tap.kind === 'add' || tap.kind === 'remove') {
      const next = applyTap(counts, tap, known);
      await this.client?.editMessage(chatId, messageId, checklistText(person.shopName, branch.multi ? branch.name : null, truncated), buildKeyboard(items, next));
      this.client?.answerCallback(cb.id);
      return;
    }

    // Send
    const ticked = [...counts].filter(([, n]) => n > 0);
    if (ticked.length === 0) {
      this.client?.answerCallback(cb.id, 'Tick at least one item first.');
      return;
    }
    const extras: StationExtra[] = ticked.map(([rawMaterialId, qty]) => ({ rawMaterialId, qty }));
    try {
      const r = await this.requests.addRequested(this.contextFor(person, branch), extras, person.name);
      const nameOf = new Map(items.map((i) => [i.id, i.name]));
      const lines = ticked.map(([id, n]) => `• ${escapeHtml(nameOf.get(id) ?? 'item')} ×${n}`);
      await this.client?.editMessage(chatId, messageId, this.sentText(lines, r.status));
      this.client?.answerCallback(cb.id, 'Sent');
    } catch (err) {
      this.logger.warn(`A Telegram supplies order failed (shop ${person.tenantId}): ${err instanceof Error ? err.message : err}`);
      this.client?.answerCallback(cb.id, err instanceof BadRequestException ? String(err.message) : 'Could not send. Try again in a minute.');
    }
  }

  // ── /need ─────────────────────────────────────────────────────────────────

  async need(chatId: string, person: OrderingPerson, text: string): Promise<void> {
    const want = readNeed(text);
    if (!want) {
      this.say(chatId, 'Write it like this: <code>/need Tissue roll, 2</code>. Or send /order for the checklist.');
      return;
    }
    const branch = await this.branchFor(person);
    if (!branch) {
      this.say(chatId, 'Clerque does not know which branch you work at. Ask the owner to set your branch.');
      return;
    }
    const twin = await this.prisma.rawMaterial.findFirst({
      where:   { tenantId: person.tenantId, name: { equals: want.name, mode: 'insensitive' } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select:  { id: true, name: true, category: true, isActive: true, subRecipeItems: { select: { id: true }, take: 1 } },
    });
    if (twin && (twin.category === 'INGREDIENT' || twin.subRecipeItems.length > 0)) {
      this.say(chatId, `${escapeHtml(twin.name)} is an ingredient. The kitchen and bar screens put ingredients on the buy list; this is for supplies.`);
      return;
    }
    const extra: StationExtra = twin
      ? { rawMaterialId: twin.id, qty: want.qty }
      : { newItem: { name: want.name, category: 'KITCHEN_SUPPLY', unit: 'pc' }, qty: want.qty };
    try {
      const r = await this.requests.addRequested(this.contextFor(person, branch), [extra], person.name);
      this.say(chatId, this.sentText([`• ${escapeHtml(twin?.name ?? want.name)} ×${want.qty}`], r.status)
        + (twin ? '' : '\nIt is new to Clerque, so the owner will set it up.'));
    } catch (err) {
      this.logger.warn(`A Telegram /need failed (shop ${person.tenantId}): ${err instanceof Error ? err.message : err}`);
      this.say(chatId, err instanceof BadRequestException ? escapeHtml(String(err.message)) : 'Could not send. Try again in a minute.');
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private sentText(lines: string[], status: string): string {
    return [
      '✅ <b>On the buy list</b>',
      ...lines,
      status === 'OPEN'
        ? 'The owner gets it with the end-of-day buy list and decides how many to buy.'
        : 'Today\'s buy list already went out, so the owner was told just now. They decide how many to buy.',
    ].join('\n');
  }

  private say(chatId: string, html: string) {
    this.client?.sendMessage(chatId, html);
  }

  private contextFor(person: OrderingPerson, branch: { id: string; name: string }): RequestContext {
    return {
      tenantId:    person.tenantId,
      branchId:    branch.id,
      branchName:  branch.name,
      stationKind: null,
      stationName: null,
      actorId:     person.userId,
      createdById: person.userId,
      byLabel:     `${person.name} (Telegram)`,
      source:      'STATION',
    };
  }

  /** Their own branch, or the shop's only branch. `multi`: the shop has more than one, so messages name it. */
  private async branchFor(person: OrderingPerson): Promise<{ id: string; name: string; multi: boolean } | null> {
    const branches = await this.prisma.branch.findMany({
      where: { tenantId: person.tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' },
    });
    const multi = branches.length > 1;
    const own = person.branchId ? branches.find((b) => b.id === person.branchId) : null;
    if (own) return { ...own, multi };
    return branches.length === 1 ? { ...branches[0], multi } : null;
  }

  /** The supplies on the checklist: active, bought (not made), and not an ingredient. What is low comes first. */
  private async items(tenantId: string, branchId: string): Promise<{ items: ChecklistItem[]; truncated: boolean }> {
    const rows = await this.prisma.rawMaterial.findMany({
      where:  { tenantId, isActive: true, category: { in: [...SUPPLY_CATEGORIES] }, subRecipeItems: { none: {} } },
      select: { id: true, name: true, lowStockAlert: true },
    });
    const stock = await this.prisma.rawMaterialInventory.findMany({
      where:  { tenantId, branchId, rawMaterialId: { in: rows.map((r) => r.id) } },
      select: { rawMaterialId: true, quantity: true },
    });
    const onHand = new Map(stock.map((s) => [s.rawMaterialId, Number(s.quantity)]));
    const all = rows.map((r) => ({
      id:   r.id,
      name: r.name,
      low:  r.lowStockAlert != null && Number(r.lowStockAlert) > 0 && (onHand.get(r.id) ?? 0) <= Number(r.lowStockAlert),
    }));
    return { items: orderItems(all), truncated: all.length > MAX_ITEMS };
  }
}
