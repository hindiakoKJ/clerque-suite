import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TelegramClient } from './telegram.client';
import {
  LINK_TTL_SECONDS, STAFF_LINK_TTL_SECONDS, isStaffLinkCode, signLinkCode, signStaffLinkCode, verifyLinkCode, verifyStaffLinkCode,
} from './link-token';
import { escapeHtml } from './messages';
import { runAsSystem, runForTenant } from '../common/tenant-context';
import { LINKABLE_ROLES, ORDER_ONLY_ROLES } from './link-roles';
import type { InlineKeyboard } from './telegram.client';

/**
 * Who a shop's alerts go to, and how a chat gets onto that list.
 *
 * The rule that keeps one cafe's sales away from another cafe's owner: a chat
 * is only ever linked from inside the shop, by the signed-in person, with a
 * code only they could get. The link stores that user; the user belongs to
 * exactly one shop. At every send the list is read again from the user's
 * CURRENT shop, role and active flag -- a manager moved to another branch, a
 * demoted owner or a deactivated account stops getting alerts at once.
 */

export { LINKABLE_ROLES, ORDER_ONLY_ROLES };

const ROLE_WORDS: Record<string, string> = { BUSINESS_OWNER: 'Owner', BRANCH_MANAGER: 'Branch manager' };

export type AlertTopic = 'sales' | 'buying';

interface TgChat { id: number | string; type?: string }
interface TgUser { id: number | string; is_bot?: boolean; username?: string }
export interface TgCallback {
  id: string;
  from?: TgUser;
  data?: string;
  message?: { message_id: number; chat?: TgChat; reply_markup?: InlineKeyboard };
}
export interface TgUpdate {
  update_id?: number;
  message?: { chat?: TgChat; from?: TgUser; text?: string };
  my_chat_member?: { chat?: TgChat; new_chat_member?: { status?: string } };
  callback_query?: TgCallback;
}

/** The person behind a linked chat, read fresh from the database for every order. */
export interface OrderingPerson {
  userId: string;
  name: string;
  role: string;
  tenantId: string;
  shopName: string;
  branchId: string | null;
}

/**
 * Takes the staff supplies orders: the checklist, its taps and "/need". Lives
 * with Procure (it writes the buy list), and registers itself here so this
 * module does not have to import Procure.
 */
export interface OrderDesk {
  open(chatId: string, person: OrderingPerson): Promise<void>;
  need(chatId: string, person: OrderingPerson, text: string): Promise<void>;
  tap(cb: TgCallback, chatId: string, person: OrderingPerson): Promise<void>;
}

@Injectable()
export class TelegramLinksService implements OnModuleInit {
  private readonly logger = new Logger('TelegramLinks');
  /** When each chat was last told "this bot only sends alerts", so chatter cannot fill the outbox. */
  private readonly toldRecently = new Map<string, number>();
  private orderDesk: OrderDesk | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramClient,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  onModuleInit() {
    this.client.onChatGone(async (chatId) => { await this.forgetChat(chatId); });
  }

  /** Procure's supplies desk, registered when Procure starts. */
  setOrderDesk(desk: OrderDesk) {
    this.orderDesk = desk;
  }

  // ── the signed-in person ────────────────────────────────────────────────

  async status(user: JwtPayload) {
    const blockedReason = !LINKABLE_ROLES.includes(user.role)
      ? 'Only the owner or a branch manager can get Telegram alerts.'
      : await this.shopRefusal(user.tenantId);
    const canLink = blockedReason == null;
    const link = user.tenantId
      ? await this.prisma.telegramLink.findFirst({
          where:  { userId: user.sub, tenantId: user.tenantId, chatId: { not: null } },
          select: { telegramUsername: true, alertSales: true, alertBuying: true, linkedAt: true },
        })
      : null;
    return {
      enabled:     this.client.enabled,
      botUsername: this.client.enabled ? await this.client.botUsername() : null,
      canLink,
      blockedReason,
      link,
    };
  }

  /**
   * Why this shop cannot use Telegram alerts, or null. The public demo shop
   * is anyone's to log into, so a link there would send its sales to whoever
   * tried the demo; a suspended shop gets nothing until it is back.
   */
  private async shopRefusal(tenantId: string | null): Promise<string | null> {
    if (!tenantId) return 'No shop on this session.';
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true, isDemoTenant: true } });
    if (!t) return 'No shop on this session.';
    if (t.isDemoTenant) return 'Telegram alerts are off for the demo shop.';
    if (t.status === 'SUSPENDED') return 'Telegram alerts are paused while this account is suspended.';
    return null;
  }

  async createLink(user: JwtPayload, nowMs = Date.now()) {
    this.assertCanLink(user);
    const refusal = await this.shopRefusal(user.tenantId);
    if (refusal) throw new ForbiddenException(refusal);
    const username = await this.client.botUsername();
    if (!username) throw new ServiceUnavailableException('Telegram cannot be reached right now. Try again in a minute.');
    const { jwtSecret, botToken } = this.client.secrets;
    const code = signLinkCode(user.sub, Math.floor(nowMs / 1000), jwtSecret, botToken);
    return {
      url:       `https://t.me/${username}?start=${code}`,
      expiresAt: new Date(nowMs + LINK_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async updateMine(user: JwtPayload, dto: { alertSales?: boolean; alertBuying?: boolean }) {
    if (!user.tenantId) throw new ForbiddenException('No shop on this session.');
    this.assertLinkableRole(user);
    const data: { alertSales?: boolean; alertBuying?: boolean } = {};
    if (typeof dto.alertSales === 'boolean') data.alertSales = dto.alertSales;
    if (typeof dto.alertBuying === 'boolean') data.alertBuying = dto.alertBuying;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change.');
    const res = await this.prisma.telegramLink.updateMany({ where: { userId: user.sub, tenantId: user.tenantId, chatId: { not: null } }, data });
    if (res.count === 0) throw new NotFoundException('Telegram is not linked for you yet.');
    return this.status(user);
  }

  async unlinkMine(user: JwtPayload) {
    if (!user.tenantId) throw new ForbiddenException('No shop on this session.');
    const link = await this.prisma.telegramLink.findFirst({
      where:  { userId: user.sub, tenantId: user.tenantId, chatId: { not: null } },
      select: { id: true, chatId: true, telegramUsername: true, tenant: { select: { name: true } } },
    });
    if (!link?.chatId) return { unlinked: false };
    // Cleared, not deleted: the row's linkedAt keeps old link codes dead.
    await this.prisma.telegramLink.updateMany({ where: { id: link.id }, data: { chatId: null, telegramUsername: null } });
    this.client.sendMessage(link.chatId, `Unlinked from Clerque. This chat will get no more alerts for ${escapeHtml(link.tenant.name)}.`);
    await this.record(user.tenantId, user.sub, 'Telegram alerts unlinked', { telegramUsername: link.telegramUsername }, null);
    return { unlinked: true };
  }

  async sendTest(user: JwtPayload) {
    if (!user.tenantId) throw new ForbiddenException('No shop on this session.');
    this.assertLinkableRole(user);
    const link = await this.prisma.telegramLink.findFirst({
      where:  { userId: user.sub, tenantId: user.tenantId, chatId: { not: null } },
      select: { chatId: true, tenant: { select: { name: true } } },
    });
    if (!link?.chatId) throw new NotFoundException('Telegram is not linked for you yet.');
    this.client.sendMessage(link.chatId, `✅ Test alert from Clerque. Alerts for <b>${escapeHtml(link.tenant.name)}</b> will arrive in this chat.`);
    return { sent: true };
  }

  // ── staff who order supplies (made by the owner or a manager) ───────────

  /**
   * The staff the signed-in owner or manager may link for ordering: active
   * staff of this shop (a manager: of their own branch, or all when they have
   * none), and whether each one's Telegram is linked.
   */
  async listStaff(user: JwtPayload) {
    this.assertLinkableRole(user);
    if (!user.tenantId) throw new ForbiddenException('No shop on this session.');
    const scope = await this.managerScope(user);
    const staff = await this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId, isActive: true, role: { in: [...ORDER_ONLY_ROLES] as any },
        ...(scope ? { OR: [{ branchId: scope }, { branchId: null }] } : {}),
      },
      select:  { id: true, name: true, role: true, branch: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const links = await this.prisma.telegramLink.findMany({
      where:  { tenantId: user.tenantId, userId: { in: staff.map((s) => s.id) }, chatId: { not: null } },
      select: { userId: true, telegramUsername: true, linkedAt: true },
    });
    const linkOf = new Map(links.map((l) => [l.userId, l]));
    return staff.map((s) => ({
      userId:   s.id,
      name:     s.name,
      role:     s.role,
      branch:   s.branch?.name ?? null,
      linked:   linkOf.has(s.id),
      telegramUsername: linkOf.get(s.id)?.telegramUsername ?? null,
      linkedAt: linkOf.get(s.id)?.linkedAt ?? null,
    }));
  }

  /** A one-time link, good for a day, that the owner hands a staff member: it lets them order supplies, and nothing else. */
  async createStaffLink(user: JwtPayload, staffUserId: string, nowMs = Date.now()) {
    this.assertCanLink(user);
    const refusal = await this.shopRefusal(user.tenantId);
    if (refusal) throw new ForbiddenException(refusal);
    const staff = await this.staffFor(user, staffUserId);
    const username = await this.client.botUsername();
    if (!username) throw new ServiceUnavailableException('Telegram cannot be reached right now. Try again in a minute.');
    const { jwtSecret, botToken } = this.client.secrets;
    const code = signStaffLinkCode(staff.id, Math.floor(nowMs / 1000), jwtSecret, botToken);
    await this.record(user.tenantId!, user.sub, 'Telegram supplies link made for staff', null, { staffUserId: staff.id, staffName: staff.name });
    return {
      url:       `https://t.me/${username}?start=${code}`,
      expiresAt: new Date(nowMs + STAFF_LINK_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async unlinkStaff(user: JwtPayload, staffUserId: string) {
    this.assertLinkableRole(user);
    const staff = await this.staffFor(user, staffUserId);
    const link = await this.prisma.telegramLink.findFirst({
      where:  { userId: staff.id, tenantId: user.tenantId!, chatId: { not: null } },
      select: { id: true, chatId: true, telegramUsername: true },
    });
    if (!link?.chatId) return { unlinked: false };
    await this.prisma.telegramLink.updateMany({ where: { id: link.id }, data: { chatId: null, telegramUsername: null } });
    this.client.sendMessage(link.chatId, 'Unlinked from Clerque. This chat can no longer order supplies.');
    await this.record(user.tenantId!, user.sub, 'Telegram supplies link removed for staff', { staffUserId: staff.id, telegramUsername: link.telegramUsername }, null);
    return { unlinked: true };
  }

  /** A manager tied to one branch only sees and links that branch's staff (and staff with no branch). */
  private async managerScope(user: JwtPayload): Promise<string | null> {
    if (user.role !== 'BRANCH_MANAGER') return null;
    const me = await this.prisma.user.findFirst({ where: { id: user.sub, tenantId: user.tenantId! }, select: { branchId: true } });
    return me?.branchId ?? null;
  }

  private async staffFor(user: JwtPayload, staffUserId: string) {
    if (!user.tenantId) throw new ForbiddenException('No shop on this session.');
    const staff = await this.prisma.user.findFirst({
      where:  { id: String(staffUserId ?? ''), tenantId: user.tenantId },
      select: { id: true, name: true, role: true, isActive: true, branchId: true },
    });
    if (!staff || !staff.isActive) throw new NotFoundException('That staff member is not in this shop, or is switched off.');
    if (!ORDER_ONLY_ROLES.includes(staff.role)) {
      throw new BadRequestException('Owners and managers link Telegram themselves, under Settings → Telegram alerts.');
    }
    const scope = await this.managerScope(user);
    if (scope && staff.branchId && staff.branchId !== scope) {
      throw new ForbiddenException('That staff member works at another branch.');
    }
    return staff;
  }

  /**
   * Who is ordering from this chat, or null. Read fresh every time: someone
   * switched off, moved to a role that cannot order, or in a suspended shop
   * cannot order from a chat linked last week.
   */
  async orderingPerson(chatId: string): Promise<OrderingPerson | null> {
    const links = await runAsSystem(async () => await this.prisma.telegramLink.findMany({
      where:   { chatId },
      orderBy: { linkedAt: 'desc' },
      select:  {
        tenantId: true,
        user:   { select: { id: true, name: true, role: true, isActive: true, tenantId: true, branchId: true } },
        tenant: { select: { name: true, status: true, isDemoTenant: true } },
      },
    }));
    for (const l of links) {
      const u = l.user;
      if (!u?.isActive || u.tenantId !== l.tenantId || !l.tenant || l.tenant.status === 'SUSPENDED' || l.tenant.isDemoTenant) continue;
      if (!ORDER_ONLY_ROLES.includes(u.role) && !LINKABLE_ROLES.includes(u.role)) continue;
      return { userId: u.id, name: u.name, role: u.role, tenantId: l.tenantId, shopName: l.tenant.name, branchId: u.branchId };
    }
    return null;
  }

  private assertCanLink(user: JwtPayload) {
    if (!this.client.enabled) throw new ServiceUnavailableException('Telegram alerts are not switched on for Clerque yet.');
    if (!user.tenantId) throw new ForbiddenException('No shop on this session.');
    this.assertLinkableRole(user);
  }

  /** Owners and branch managers only -- for making a link and for everything done with one. Unlinking stays open to anyone, so nobody is ever stuck with alerts. */
  private assertLinkableRole(user: JwtPayload) {
    if (!LINKABLE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the owner or a branch manager can get Telegram alerts.');
    }
  }

  // ── who gets an alert ───────────────────────────────────────────────────

  /**
   * The chats for one alert: linked by an active owner of this shop, or an
   * active manager of this branch (or of every branch), who has not muted
   * this kind. Read fresh every time; nothing about a person is cached.
   */
  /** ownersOnly: for what the managers must not see, like a roll call's missing parts. */
  async recipients(tenantId: string, branchId: string | null, topic: AlertTopic, ownersOnly = false): Promise<string[]> {
    const links = await this.prisma.telegramLink.findMany({
      where: {
        tenantId,
        chatId: { not: null },
        ...(topic === 'sales' ? { alertSales: true } : { alertBuying: true }),
        tenant: { status: { not: 'SUSPENDED' }, isDemoTenant: false },
        user: {
          tenantId,
          isActive: true,
          OR: [
            { role: 'BUSINESS_OWNER' },
            ...(ownersOnly ? [] : [{ role: 'BRANCH_MANAGER' as const, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] }]),
          ],
        },
      },
      select: { chatId: true },
    });
    return [...new Set(links.map((l) => l.chatId).filter((c): c is string => !!c))];
  }

  /** Cheap first check before an alert loads anything: does this shop have anyone linked for this kind at all? */
  async anyoneListening(tenantId: string, topic: AlertTopic): Promise<boolean> {
    const n = await this.prisma.telegramLink.count({
      where: { tenantId, chatId: { not: null }, ...(topic === 'sales' ? { alertSales: true } : { alertBuying: true }) },
    });
    return n > 0;
  }

  // ── what Telegram sends us ──────────────────────────────────────────────

  async handleUpdate(update: TgUpdate, nowMs = Date.now()): Promise<void> {
    const member = update.my_chat_member;
    if (member?.chat && member.new_chat_member?.status === 'kicked') {
      await this.forgetChat(String(member.chat.id));
      return;
    }
    const cb = update.callback_query;
    if (cb) {
      await this.handleTap(cb);
      return;
    }
    const msg = update.message;
    if (!msg?.chat || msg.from?.is_bot) return;
    const chatId = String(msg.chat.id);
    const text = (msg.text ?? '').trim();

    if (msg.chat.type !== 'private') {
      // Never alerts there, so never a reply either: a group could otherwise make the bot talk until Telegram throttles it.
      this.client.leaveChat(chatId);
      return;
    }
    if (/^\/start(@\w+)?(\s|$)/.test(text)) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        this.client.sendMessage(chatId, 'To get alerts, open Clerque, go to Settings → Telegram alerts and tap <b>Make my link</b>.');
        return;
      }
      if (isStaffLinkCode(code)) await this.consumeStaff(chatId, msg.from?.username ?? null, code, nowMs);
      else await this.consume(chatId, msg.from?.username ?? null, code, nowMs);
      return;
    }
    if (/^\/(order|need)(@\w+)?(\s|$)/i.test(text)) {
      const person = await this.orderingPerson(chatId);
      if (!person) {
        this.client.sendMessage(chatId, 'This chat is not linked to a Clerque shop. Ask the owner for your supplies link.');
        return;
      }
      if (!this.orderDesk) {
        this.client.sendMessage(chatId, 'Ordering is not available right now. Try again in a few minutes.');
        return;
      }
      const desk = this.orderDesk;
      await runForTenant(person.tenantId, async () => {
        if (/^\/order/i.test(text)) await desk.open(chatId, person);
        else await desk.need(chatId, person, text);
      });
      return;
    }
    if (/^\/stop(@\w+)?$/.test(text)) {
      const n = await this.forgetChat(chatId);
      this.client.sendMessage(chatId, n > 0 ? 'Unlinked. This chat will get no more Clerque alerts.' : 'This chat is not linked to Clerque.');
      return;
    }
    // At most once every ten minutes per chat.
    const last = this.toldRecently.get(chatId) ?? 0;
    if (nowMs - last < 10 * 60_000) return;
    if (this.toldRecently.size > 10_000) this.toldRecently.clear();
    this.toldRecently.set(chatId, nowMs);
    this.client.sendMessage(chatId, 'This bot sends Clerque alerts and takes supply orders: send /order. To unlink, send /stop.');
  }

  /** A tap on a checklist button. Only ever from a private chat the bot wrote the checklist into. */
  private async handleTap(cb: TgCallback) {
    const chat = cb.message?.chat;
    if (!chat || chat.type !== 'private' || cb.from?.is_bot) {
      this.client.answerCallback(cb.id);
      return;
    }
    const chatId = String(chat.id);
    const person = await this.orderingPerson(chatId);
    if (!person || !this.orderDesk) {
      this.client.answerCallback(cb.id, person ? 'Ordering is not available right now.' : 'This chat is no longer linked to Clerque.');
      return;
    }
    const desk = this.orderDesk;
    await runForTenant(person.tenantId, () => desk.tap(cb, chatId, person));
  }

  private async consume(chatId: string, username: string | null, code: string, nowMs: number) {
    const { jwtSecret, botToken } = this.client.secrets;
    const check = verifyLinkCode(code, Math.floor(nowMs / 1000), jwtSecret, botToken);
    if (!check.ok) {
      this.client.sendMessage(chatId, check.reason === 'expired'
        ? 'That link has expired. In Clerque, open Settings → Telegram alerts and tap <b>Make my link</b> again.'
        : 'That link is not valid. In Clerque, open Settings → Telegram alerts and tap <b>Make my link</b> again.');
      return;
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      // One code, one winner: two chats racing the same code queue on the user's row.
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${check.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where:  { id: check.userId },
        select: {
          id: true, name: true, role: true, isActive: true, tenantId: true,
          branch: { select: { name: true } },
          tenant: { select: { name: true, status: true, isDemoTenant: true } },
        },
      });
      if (!user || !user.isActive || !user.tenantId || !user.tenant || user.tenant.status === 'SUSPENDED'
          || user.tenant.isDemoTenant || !LINKABLE_ROLES.includes(user.role)) {
        return { kind: 'refused' as const };
      }
      const existing = await tx.telegramLink.findUnique({ where: { userId: user.id } });
      // A link made at or after this code was issued means the code was already used -- the row stays after an unlink, so this holds across restarts.
      if (existing && existing.linkedAt.getTime() >= check.issuedAt * 1000) {
        return { kind: 'used' as const, sameChat: existing.chatId === chatId };
      }
      const link = await tx.telegramLink.upsert({
        where:  { userId: user.id },
        create: { tenantId: user.tenantId, userId: user.id, chatId, telegramUsername: username },
        update: { tenantId: user.tenantId, chatId, telegramUsername: username, linkedAt: new Date(nowMs) },
      });
      return { kind: 'linked' as const, user, link, previousChat: existing?.chatId && existing.chatId !== chatId ? existing.chatId : null };
    });

    if (outcome.kind === 'refused') {
      this.client.sendMessage(chatId, 'This link cannot be used. Only an active owner or branch manager of a live shop can link Telegram alerts.');
      return;
    }
    if (outcome.kind === 'used') {
      this.client.sendMessage(chatId, outcome.sameChat
        ? 'This chat is already linked.'
        : 'This link was already used. If that was not you, open Clerque → Settings → Telegram alerts and unlink.');
      return;
    }

    const { user, link, previousChat } = outcome;
    const shop = user.tenant!.name;
    const role = ROLE_WORDS[user.role] ?? user.role;
    const scope = user.role === 'BRANCH_MANAGER' && user.branch ? ` (${user.branch.name})` : '';
    this.client.sendMessage(chatId, [
      '✅ <b>Linked to Clerque</b>',
      `You will get alerts for <b>${escapeHtml(shop)}</b>${escapeHtml(scope)} as ${escapeHtml(user.name)}, ${escapeHtml(role)}.`,
      'To stop, send /stop or unlink under Settings → Telegram alerts.',
    ].join('\n'));
    if (previousChat) {
      this.client.sendMessage(previousChat, `This chat no longer gets alerts for ${escapeHtml(shop)}: ${escapeHtml(user.name)} linked another Telegram chat.`);
    }
    // Told inside Clerque too, so a link someone else made with a leaked code does not go unnoticed.
    try {
      await this.notifications?.create({
        tenantId: user.tenantId!, userId: user.id, kind: 'INFO',
        title: 'Telegram alerts linked',
        body:  `Alerts now go to ${username ? `@${username}` : 'a Telegram chat'}. Not you? Unlink under Settings → Telegram alerts.`,
        link:  '/settings/telegram',
      });
    } catch (err) {
      this.logger.warn(`Could not add the linked notification: ${err instanceof Error ? err.message : err}`);
    }
    await this.record(user.tenantId!, user.id, 'Telegram alerts linked', null, { telegramUsername: link.telegramUsername });
  }

  /**
   * A staff member's link: ordering supplies only. Saved with every alert
   * switched off, and the alert reader never picks these roles anyway.
   */
  private async consumeStaff(chatId: string, username: string | null, code: string, nowMs: number) {
    const { jwtSecret, botToken } = this.client.secrets;
    const check = verifyStaffLinkCode(code, Math.floor(nowMs / 1000), jwtSecret, botToken);
    if (!check.ok) {
      this.client.sendMessage(chatId, check.reason === 'expired'
        ? 'That link has expired. Ask the owner for a new one.'
        : 'That link is not valid. Ask the owner for a new one.');
      return;
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${check.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where:  { id: check.userId },
        select: {
          id: true, name: true, role: true, isActive: true, tenantId: true,
          tenant: { select: { name: true, status: true, isDemoTenant: true } },
        },
      });
      if (!user || !user.isActive || !user.tenantId || !user.tenant || user.tenant.status === 'SUSPENDED'
          || user.tenant.isDemoTenant || !ORDER_ONLY_ROLES.includes(user.role)) {
        return { kind: 'refused' as const };
      }
      const existing = await tx.telegramLink.findUnique({ where: { userId: user.id } });
      if (existing && existing.linkedAt.getTime() >= check.issuedAt * 1000) {
        return { kind: 'used' as const, sameChat: existing.chatId === chatId };
      }
      await tx.telegramLink.upsert({
        where:  { userId: user.id },
        create: { tenantId: user.tenantId, userId: user.id, chatId, telegramUsername: username, alertSales: false, alertBuying: false },
        update: { tenantId: user.tenantId, chatId, telegramUsername: username, alertSales: false, alertBuying: false, linkedAt: new Date(nowMs) },
      });
      return { kind: 'linked' as const, user };
    });

    if (outcome.kind === 'refused') {
      this.client.sendMessage(chatId, 'This link cannot be used. Ask the owner to check that your account is switched on.');
      return;
    }
    if (outcome.kind === 'used') {
      this.client.sendMessage(chatId, outcome.sameChat ? 'This chat is already linked.' : 'This link was already used. Ask the owner for a new one.');
      return;
    }
    const { user } = outcome;
    this.client.sendMessage(chatId, [
      '✅ <b>Linked to Clerque</b>',
      `Hi ${escapeHtml(user.name)}! You can now ask for supplies for <b>${escapeHtml(user.tenant!.name)}</b>.`,
      'Send /order to open the checklist. To unlink, send /stop.',
    ].join('\n'));
    await this.record(user.tenantId!, user.id, 'Telegram supplies link used', null, { telegramUsername: username });
  }

  /**
   * Unlinks every user on a chat: /stop, the bot blocked, or the chat refusing messages.
   * In every shop by design (one phone can serve two shops), so it runs as system work:
   * the outbox that calls it may be draining inside some other shop's request.
   */
  async forgetChat(chatId: string): Promise<number> {
    const res = await runAsSystem(async () =>
      await this.prisma.telegramLink.updateMany({ where: { chatId }, data: { chatId: null, telegramUsername: null } }));
    if (res.count > 0) this.logger.log(`Unlinked ${res.count} Clerque user(s) from a Telegram chat that stopped the bot.`);
    return res.count;
  }

  private async record(tenantId: string, userId: string, description: string, before: object | null, after: object | null) {
    try {
      await this.audit?.log({
        tenantId, action: 'SETTING_CHANGED', entityType: 'TelegramLink', entityId: userId,
        before, after, description, performedBy: userId,
      });
    } catch (err) {
      this.logger.warn(`Could not write the audit row: ${err instanceof Error ? err.message : err}`);
    }
  }
}
