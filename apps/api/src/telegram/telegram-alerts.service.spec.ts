import { TelegramAlertsService } from './telegram-alerts.service';
import type { UsageDay } from '../ingredient-reports/daily-usage';

/** Each alert: loads what it says only for a shop someone listens to, sends to exactly the recipients, never throws. */
describe('TelegramAlertsService', () => {
  const ORDER = {
    orderNumber: 'ORD-2026-000123', branchId: 'b1', channel: 'POS',
    paidAt: new Date('2026-09-15T10:42:00+08:00'), createdAt: new Date('2026-09-15T10:42:01+08:00'),
    subtotal: 150, discountAmount: 0, vatAmount: 16.07, totalAmount: 150,
    branch: { name: 'Main' }, tenant: { name: 'Cafe Carolina' }, createdBy: { name: 'Maria' },
    items: [{ productName: 'Latte', quantity: 1, unitPrice: 150, lineTotal: 150, modifiers: [] }],
    payments: [{ method: 'CASH', amount: 150 }], discounts: [],
  };
  const REQUEST = {
    requestNumber: 'PR-0012', branchId: 'b2', branch: { name: 'Mall' }, tenant: { name: 'Cafe Carolina' },
    lines: [{ packsBought: 2, packSize: 1000, packCost: 95, receivedAt: new Date(), rawMaterial: { name: 'Milk', unit: 'ml' } }],
  };

  function build(opts: { enabled?: boolean; listening?: boolean; chats?: string[]; orderFails?: boolean } = {}) {
    const prisma: any = {
      order: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (opts.orderFails) throw new Error('database down');
          return where.tenantId === 't1' ? ORDER : null;
        }),
      },
      purchaseRequest: { findFirst: jest.fn(async ({ where }: any) => (where.tenantId === 't1' ? REQUEST : null)) },
      branch: { findFirst: jest.fn(async ({ where }: any) => (where.tenantId === 't1' && where.id === 'b1' ? { name: 'Main', tenant: { name: 'Cafe Carolina' } } : null)) },
      user: { findFirst: jest.fn(async ({ where }: any) => (where.tenantId === 't1' ? { name: 'Anne' } : null)) },
    };
    const client: any = { enabled: opts.enabled ?? true, sendMessage: jest.fn(), sendPhoto: jest.fn() };
    const links: any = {
      anyoneListening: jest.fn(async () => opts.listening ?? true),
      recipients: jest.fn(async () => opts.chats ?? ['101', '102']),
    };
    return { svc: new TelegramAlertsService(prisma, client, links), prisma, client, links };
  }

  it('a sale goes to every recipient for that sale\'s branch', async () => {
    const { svc, client, links } = build();
    await svc.saleConfirmed('t1', 'o1');
    expect(links.recipients).toHaveBeenCalledWith('t1', 'b1', 'sales');
    expect(client.sendMessage.mock.calls.map((c: any[]) => c[0])).toEqual(['101', '102']);
    expect(client.sendMessage.mock.calls[0][1]).toContain('Sale ORD-2026-000123');
  });

  it('a shop nobody listens to costs one count and nothing else', async () => {
    const { svc, prisma, client } = build({ listening: false });
    await svc.saleConfirmed('t1', 'o1');
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('an order is only read inside its own shop', async () => {
    const { svc, prisma, client } = build();
    await svc.saleConfirmed('t2', 'o1');
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: 'o1', tenantId: 't2' });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('with Telegram off, nothing is read at all', async () => {
    const { svc, links, prisma } = build({ enabled: false });
    await svc.saleConfirmed('t1', 'o1');
    await svc.bought('t1', 'r1', 'u1');
    expect(links.anyoneListening).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('never rejects: a broken database only costs the alert', async () => {
    const { svc } = build({ orderFails: true });
    await expect(svc.saleConfirmed('t1', 'o1')).resolves.toBeUndefined();
  });

  it('buying alerts go to the recipients for the request\'s branch, with the buying topic', async () => {
    const { svc, client, links } = build({ chats: ['101'] });
    await svc.buyListSent('t1', 'r1', [{ name: 'Milk', amount: '2 packs' }], 'u1');
    await svc.bought('t1', 'r1', 'u1');
    await svc.postedToStock('t1', 'r1', 'u1');
    await svc.purchasePhoto('t1', 'r1', Buffer.from('jpg'), 'image/jpeg', 'Receipt', 'u1');
    expect(links.recipients.mock.calls.every((c: any[]) => c[1] === 'b2' && c[2] === 'buying')).toBe(true);
    const texts = client.sendMessage.mock.calls.map((c: any[]) => c[1]);
    expect(texts[0]).toContain('Buy list PR-0012 sent');
    expect(texts[1]).toContain('Bought: PR-0012');
    expect(texts[2]).toContain('In stock: PR-0012');
    expect(client.sendPhoto).toHaveBeenCalledWith('101', Buffer.from('jpg'), 'image/jpeg', expect.stringContaining('Receipt photo: PR-0012'), expect.any(String));
  });

  describe('dailyUsage -- the end-of-day ingredient sheet', () => {
    // What the end-of-day job read for the bell. Its value is not the rows' sum on purpose: the message must show this figure, not work out its own.
    const DAY: UsageDay = {
      day: '2026-09-16',
      rows: [{
        rawMaterialId: 'rm-milk', name: 'Fresh Milk', unit: 'ml', costPrice: 0.1,
        sold: 7000, wasted: 1100, intoPreps: 0, writtenOff: 0, total: 8100, value: 810,
      }],
      totals: { soldValue: 700, wastedValue: 110, intoPrepsValue: 0, writtenOffValue: 0, value: 777.77 },
      stillBeingMade: 0,
    };

    it('goes to the recipients for that branch on the buying switch, showing exactly the reading it is handed', async () => {
      const { svc, client, links, prisma } = build();
      await svc.dailyUsage('t1', 'b1', DAY, 0);
      expect(links.anyoneListening).toHaveBeenCalledWith('t1', 'buying');
      expect(links.recipients).toHaveBeenCalledWith('t1', 'b1', 'buying');
      expect(prisma.branch.findFirst.mock.calls[0][0].where).toEqual({ id: 'b1', tenantId: 't1' });
      expect(client.sendMessage.mock.calls.map((c: any[]) => c[0])).toEqual(['101', '102']);
      const text = client.sendMessage.mock.calls[0][1];
      expect(text).toContain('<b>Ingredients used today</b>');
      expect(text).toContain('Cafe Carolina · Main');
      expect(text).toContain('Wed, Sep 16');
      expect(text).toMatch(/Fresh Milk +8\.1 L/);
      expect(text).toMatch(/of it wasted +1\.1 L/);
      expect(text).toMatch(/VALUE AT COST +₱777\.77/);
      expect(text).not.toContain('reached Clerque');
    });

    it('reads no usage of its own: only the branch name is looked up', async () => {
      const { svc, client, prisma } = build();
      await svc.dailyUsage('t1', 'b1', DAY, 0);
      expect(client.sendMessage).toHaveBeenCalledTimes(2);
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(prisma.branch.findFirst).toHaveBeenCalledTimes(1);
    });

    it('says how many sales reached Clerque too late for any sheet', async () => {
      const { svc, client } = build({ chats: ['101'] });
      await svc.dailyUsage('t1', 'b1', DAY, 2);
      expect(client.sendMessage.mock.calls[0][1]).toContain("2 sales rung up offline reached Clerque after their day's sheet went out.");
    });

    it('a shop nobody listens to is not read at all', async () => {
      const { svc, client, prisma } = build({ listening: false });
      await svc.dailyUsage('t1', 'b1', DAY, 0);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('no recipient for the branch: the branch is not read', async () => {
      const { svc, client, prisma } = build({ chats: [] });
      await svc.dailyUsage('t1', 'b1', DAY, 0);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('a branch of another shop sends nothing', async () => {
      const { svc, client } = build();
      await svc.dailyUsage('t2', 'b1', DAY, 0);
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('never rejects: a bad day or a failed read only costs the message', async () => {
      const { svc, client, prisma } = build();
      await expect(svc.dailyUsage('t1', 'b1', { ...DAY, day: '2026-02-30' }, 0)).resolves.toBeUndefined();
      prisma.branch.findFirst.mockRejectedValueOnce(new Error('database down'));
      await expect(svc.dailyUsage('t1', 'b1', DAY, 0)).resolves.toBeUndefined();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });
});
