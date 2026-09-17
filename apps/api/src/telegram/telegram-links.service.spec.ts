import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { TelegramLinksService } from './telegram-links.service';
import { TelegramClient } from './telegram.client';
import { signLinkCode, verifyLinkCode } from './link-token';

/**
 * Linking a chat, and who a shop's alerts reach. The fake database applies
 * the filters the service sends -- shop, role, branch, active, muted -- so a
 * dropped condition sends an alert to the wrong person here first.
 */
describe('TelegramLinksService', () => {
  const JWT = 'jwt';
  const BOT = '123:bot';
  const NOW = 1_800_000_000_000;
  const sec = Math.floor(NOW / 1000);

  type User = { id: string; name: string; role: string; isActive: boolean; tenantId: string; branchId: string | null };
  type Link = { id: string; tenantId: string; userId: string; chatId: string | null; telegramUsername: string | null; alertSales: boolean; alertBuying: boolean; linkedAt: Date };

  function build(opts: { enabled?: boolean } = {}) {
    const tenants: Record<string, { name: string; status: string; isDemoTenant: boolean }> = {
      carolina: { name: 'Cafe Carolina', status: 'ACTIVE', isDemoTenant: false },
      other:    { name: 'Other Cafe', status: 'ACTIVE', isDemoTenant: false },
      demo:     { name: 'Demo', status: 'ACTIVE', isDemoTenant: true },
    };
    const branches: Record<string, string> = { b1: 'Main', b2: 'Mall' };
    const users: User[] = [
      { id: 'anne', name: 'Anne', role: 'BUSINESS_OWNER', isActive: true, tenantId: 'carolina', branchId: null },
      { id: 'mgr1', name: 'Mara', role: 'BRANCH_MANAGER', isActive: true, tenantId: 'carolina', branchId: 'b1' },
      { id: 'mgr2', name: 'Mike', role: 'BRANCH_MANAGER', isActive: true, tenantId: 'carolina', branchId: 'b2' },
      { id: 'mgrall', name: 'Mina', role: 'BRANCH_MANAGER', isActive: true, tenantId: 'carolina', branchId: null },
      { id: 'cook', name: 'Cook', role: 'GENERAL_EMPLOYEE', isActive: true, tenantId: 'carolina', branchId: 'b1' },
      { id: 'gone', name: 'Gone', role: 'BUSINESS_OWNER', isActive: false, tenantId: 'carolina', branchId: null },
      { id: 'bob', name: 'Bob', role: 'BUSINESS_OWNER', isActive: true, tenantId: 'other', branchId: null },
      { id: 'demoowner', name: 'Demo', role: 'BUSINESS_OWNER', isActive: true, tenantId: 'demo', branchId: null },
    ];
    const links: Link[] = [];
    const sent: Array<{ chatId: string; text: string }> = [];
    let seq = 0;

    const linkMatches = (l: Link, where: any) => {
      if (where.id && l.id !== where.id) return false;
      if (where.userId && l.userId !== where.userId) return false;
      if (typeof where.chatId === 'string' && l.chatId !== where.chatId) return false;
      if (where.chatId && typeof where.chatId === 'object' && 'not' in where.chatId && l.chatId === where.chatId.not) return false;
      if (where.tenantId && l.tenantId !== where.tenantId) return false;
      if (where.alertSales === true && !l.alertSales) return false;
      if (where.alertBuying === true && !l.alertBuying) return false;
      if (where.tenant) {
        const t = tenants[l.tenantId];
        if (where.tenant.status?.not && t.status === where.tenant.status.not) return false;
        if (where.tenant.isDemoTenant === false && t.isDemoTenant) return false;
      }
      if (where.user) {
        const u = users.find((x) => x.id === l.userId)!;
        if (where.user.tenantId && u.tenantId !== where.user.tenantId) return false;
        if (where.user.isActive === true && !u.isActive) return false;
        if (where.user.OR && !where.user.OR.some((c: any) => {
          if (c.role !== u.role) return false;
          if (!c.OR) return true;
          return c.OR.some((b: any) => b.branchId === u.branchId);
        })) return false;
      }
      return true;
    };
    const viewUser = (u: User) => ({ ...u, branch: u.branchId ? { name: branches[u.branchId] } : null, tenant: tenants[u.tenantId] });

    const prisma: any = {
      telegramLink: {
        findFirst: jest.fn(async ({ where, select }: any) => {
          const l = links.find((x) => linkMatches(x, where));
          if (!l) return null;
          return select?.tenant ? { ...l, tenant: { name: tenants[l.tenantId].name } } : { ...l };
        }),
        findUnique: jest.fn(async ({ where }: any) => { const l = links.find((x) => x.userId === where.userId); return l ? { ...l } : null; }),
        findMany: jest.fn(async ({ where }: any) => links.filter((x) => linkMatches(x, where)).map((l) => ({ chatId: l.chatId }))),
        count: jest.fn(async ({ where }: any) => links.filter((x) => linkMatches(x, where)).length),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const l = links.find((x) => x.userId === where.userId);
          if (l) { Object.assign(l, update); return l; }
          const row: Link = { id: `l${++seq}`, alertSales: true, alertBuying: true, linkedAt: new Date(NOW), telegramUsername: null, ...create };
          links.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = links.filter((x) => linkMatches(x, where));
          hit.forEach((l) => Object.assign(l, data));
          return { count: hit.length };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          const hit = links.filter((x) => linkMatches(x, where));
          hit.forEach((l) => links.splice(links.indexOf(l), 1));
          return { count: hit.length };
        }),
      },
      user: { findUnique: jest.fn(async ({ where }: any) => { const u = users.find((x) => x.id === where.id); return u ? viewUser(u) : null; }) },
      tenant: { findUnique: jest.fn(async ({ where }: any) => tenants[where.id] ?? null) },
      $queryRaw: jest.fn(async () => []),
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));

    const client = {
      enabled: opts.enabled ?? true,
      secrets: { jwtSecret: JWT, botToken: BOT },
      botUsername: jest.fn(async () => 'ClerqueAlertsBot'),
      sendMessage: jest.fn((chatId: string, text: string) => { sent.push({ chatId, text }); }),
      leaveChat: jest.fn(),
      onChatGone: jest.fn(),
    } as unknown as TelegramClient;
    const notifications = { create: jest.fn(async () => ({})) };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new TelegramLinksService(prisma, client, notifications as any, audit as any);
    const start = (chatId: string, code: string, extra: any = {}) =>
      svc.handleUpdate({ message: { chat: { id: chatId, type: 'private' }, from: { id: chatId, username: `u${chatId}` }, text: `/start ${code}`, ...extra } }, NOW);
    const codeFor = (userId: string, at = sec) => signLinkCode(userId, at, JWT, BOT);
    return { svc, links, users, tenants, sent, prisma, notifications, start, codeFor, client };
  }

  const session = (id: string, role: string, tenantId = 'carolina') => ({ sub: id, role, tenantId } as any);

  describe('getting a link', () => {
    it('gives the signed-in owner a t.me link whose code names them and no one else', async () => {
      const { svc } = build();
      const { url, expiresAt } = await svc.createLink(session('anne', 'BUSINESS_OWNER'), NOW);
      const code = url.split('?start=')[1];
      expect(url.startsWith('https://t.me/ClerqueAlertsBot?start=')).toBe(true);
      expect(verifyLinkCode(code, sec, JWT, BOT)).toMatchObject({ ok: true, userId: 'anne' });
      expect(new Date(expiresAt).getTime()).toBe(NOW + 600_000);
    });

    it('the demo shop cannot link, and says why instead of failing quietly', async () => {
      const { svc } = build();
      await expect(svc.createLink(session('demoowner', 'BUSINESS_OWNER', 'demo'), NOW)).rejects.toThrow('Telegram alerts are off for the demo shop.');
      expect(await svc.status(session('demoowner', 'BUSINESS_OWNER', 'demo'))).toMatchObject({ canLink: false, blockedReason: 'Telegram alerts are off for the demo shop.' });
    });

    it('a shop in its payment grace period still links and still gets alerts; a suspended one does not', async () => {
      const { svc, tenants, start, codeFor } = build();
      tenants.carolina.status = 'GRACE';
      await start('9001', codeFor('anne'));
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual(['9001']);
      tenants.carolina.status = 'SUSPENDED';
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual([]);
      await expect(svc.createLink(session('anne', 'BUSINESS_OWNER'), NOW)).rejects.toThrow(ForbiddenException);
    });

    it('a cook cannot get one; nobody can while Telegram is off', async () => {
      await expect(build().svc.createLink(session('cook', 'GENERAL_EMPLOYEE'), NOW)).rejects.toThrow(ForbiddenException);
      await expect(build({ enabled: false }).svc.createLink(session('anne', 'BUSINESS_OWNER'), NOW)).rejects.toThrow(ServiceUnavailableException);
    });

    it('only owners and managers can change what they get or send a test; only a manager keeps the link capability', async () => {
      const { svc } = build();
      for (const role of ['GENERAL_EMPLOYEE', 'CASHIER', 'SALES_LEAD', 'MDM', 'WAREHOUSE_STAFF']) {
        await expect(svc.updateMine(session('cook', role), { alertSales: false })).rejects.toThrow(ForbiddenException);
        await expect(svc.sendTest(session('cook', role))).rejects.toThrow(ForbiddenException);
        expect(await svc.status(session('cook', role))).toMatchObject({ canLink: false });
      }
      // Unlinking is never blocked, so nobody is stuck with alerts.
      await expect(svc.unlinkMine(session('cook', 'CASHIER'))).resolves.toEqual({ unlinked: false });
    });
  });

  describe('using the link in Telegram', () => {
    it('links the chat to that person in their own shop, says so, and tells them inside Clerque too', async () => {
      const { links, sent, start, codeFor, notifications } = build();
      await start('9001', codeFor('anne'));
      expect(links).toEqual([expect.objectContaining({ userId: 'anne', tenantId: 'carolina', chatId: '9001', telegramUsername: 'u9001' })]);
      expect(sent[0]).toMatchObject({ chatId: '9001' });
      expect(sent[0].text).toContain('<b>Cafe Carolina</b>');
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'carolina', userId: 'anne', title: 'Telegram alerts linked' }));
    });

    it('a used code cannot link a second chat -- not even after the first one unlinked and the API restarted', async () => {
      const { links, sent, start, codeFor, svc, prisma, client } = build();
      const code = codeFor('anne');
      await start('9001', code);
      await start('6666', code);
      expect(links.map((l) => l.chatId)).toEqual(['9001']);
      expect(sent.at(-1)).toMatchObject({ chatId: '6666' });
      expect(sent.at(-1)!.text).toContain('already used');

      await svc.unlinkMine(session('anne', 'BUSINESS_OWNER'));
      expect(links.map((l) => l.chatId)).toEqual([null]);   // the row stays, with its linkedAt
      const restarted = new TelegramLinksService(prisma, client, undefined, undefined);
      await restarted.handleUpdate({ message: { chat: { id: '6666', type: 'private' }, from: { id: 6666 }, text: `/start ${code}` } }, NOW);
      expect(links.map((l) => l.chatId)).toEqual([null]);
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual([]);
    });

    it('after unlinking, a new code links again', async () => {
      const { links, start, codeFor, svc } = build();
      await start('9001', codeFor('anne', sec - 30));
      await svc.unlinkMine(session('anne', 'BUSINESS_OWNER'));
      await start('9002', codeFor('anne', sec + 5));
      expect(links.map((l) => l.chatId)).toEqual(['9002']);
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual(['9002']);
    });

    it('a code issued before the current link is refused by the database check alone (after a restart)', async () => {
      const first = build();
      const oldCode = first.codeFor('anne', sec - 60);
      await first.start('9001', first.codeFor('anne'));
      // A fresh service has no memory of used codes, like after a redeploy.
      const again = new TelegramLinksService(first.prisma, first.client, undefined, undefined);
      await again.handleUpdate({ message: { chat: { id: '6666', type: 'private' }, from: { id: 1 }, text: `/start ${oldCode}` } }, NOW);
      expect(first.links.map((l) => l.chatId)).toEqual(['9001']);
    });

    it('expired or altered codes link nothing', async () => {
      const { links, sent, start, codeFor } = build();
      await start('9001', codeFor('anne', sec - 601));
      await start('9001', codeFor('anne').replace('anne', 'bob0'));
      expect(links).toHaveLength(0);
      expect(sent[0].text).toContain('expired');
      expect(sent[1].text).toContain('not valid');
    });

    it('refuses a cook, a deactivated owner and the demo shop, even with a genuine code', async () => {
      const { links, start, codeFor } = build();
      await start('1', codeFor('cook'));
      await start('2', codeFor('gone'));
      await start('3', codeFor('demoowner'));
      expect(links).toHaveLength(0);
    });

    it('only in a private chat, and never from another bot; a group is left without a word', async () => {
      const { links, sent, svc, codeFor, client } = build();
      await svc.handleUpdate({ message: { chat: { id: '-100', type: 'group' }, from: { id: 5 }, text: `/start ${codeFor('anne')}` } }, NOW);
      await svc.handleUpdate({ message: { chat: { id: '5', type: 'private' }, from: { id: 5, is_bot: true }, text: `/start ${codeFor('anne')}` } }, NOW);
      expect(links).toHaveLength(0);
      expect(sent).toHaveLength(0);
      expect(client.leaveChat).toHaveBeenCalledWith('-100');
    });

    it('chatter gets one reply per ten minutes, so strangers cannot make the bot talk non-stop', async () => {
      const { sent, svc } = build();
      const say = (at: number) => svc.handleUpdate({ message: { chat: { id: '42', type: 'private' }, from: { id: 42 }, text: 'hello?' } }, at);
      await say(NOW);
      await say(NOW + 1000);
      await say(NOW + 11 * 60_000);
      expect(sent.map((m) => m.chatId)).toEqual(['42', '42']);
    });

    it('linking again from a new phone moves the alerts and tells the old chat', async () => {
      const { links, sent, start, codeFor } = build();
      await start('9001', codeFor('anne', sec - 30));
      await start('9002', codeFor('anne', sec + 5));
      expect(links.map((l) => l.chatId)).toEqual(['9002']);
      expect(sent.find((m) => m.chatId === '9001' && m.text.includes('no longer gets alerts'))).toBeTruthy();
    });

    it('/stop and blocking the bot both unlink the chat', async () => {
      const { links, svc, start, codeFor } = build();
      await start('9001', codeFor('anne'));
      await start('9002', codeFor('mgr1'));
      await svc.handleUpdate({ message: { chat: { id: '9001', type: 'private' }, from: { id: 9001 }, text: '/stop' } }, NOW);
      await svc.handleUpdate({ my_chat_member: { chat: { id: '9002', type: 'private' }, new_chat_member: { status: 'kicked' } } }, NOW);
      expect(links.map((l) => l.chatId)).toEqual([null, null]);
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual([]);
    });
  });

  describe('who gets an alert', () => {
    async function everyoneLinked() {
      const t = build();
      let chat = 100;
      for (const id of ['anne', 'mgr1', 'mgr2', 'mgrall', 'bob']) await t.start(String(++chat), t.codeFor(id));
      return t;
    }

    it('the owner and the managers of that branch -- never another shop\'s owner', async () => {
      const { svc } = await everyoneLinked();
      // anne=101, mgr1=102 (b1), mgr2=103 (b2), mgrall=104, bob=105 (other shop)
      expect((await svc.recipients('carolina', 'b1', 'sales')).sort()).toEqual(['101', '102', '104']);
      expect((await svc.recipients('carolina', 'b2', 'buying')).sort()).toEqual(['101', '103', '104']);
      expect(await svc.recipients('other', 'bx', 'sales')).toEqual(['105']);
    });

    it('reads people as they are now: deactivated, demoted or muted stops the alerts', async () => {
      const { svc, users, links } = await everyoneLinked();
      users.find((u) => u.id === 'mgr1')!.isActive = false;
      users.find((u) => u.id === 'mgrall')!.role = 'CASHIER';
      links.find((l) => l.userId === 'anne')!.alertSales = false;
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual([]);
      expect(await svc.recipients('carolina', 'b1', 'buying')).toEqual(['101']);
    });

    it('a link whose person moved to another shop does not carry the old shop\'s alerts', async () => {
      const { svc, users } = await everyoneLinked();
      users.find((u) => u.id === 'anne')!.tenantId = 'other';
      expect(await svc.recipients('carolina', 'b1', 'sales')).not.toContain('101');
    });

    it('two people on one phone get one message', async () => {
      const { svc, start, codeFor } = build();
      await start('777', codeFor('anne'));
      await start('777', codeFor('mgr1'));
      expect(await svc.recipients('carolina', 'b1', 'sales')).toEqual(['777']);
    });
  });
});
