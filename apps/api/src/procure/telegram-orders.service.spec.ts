import { TelegramOrdersService } from './telegram-orders.service';
import { buildKeyboard, readCounts } from '../telegram/order-checklist';
import type { OrderingPerson } from '../telegram/telegram-links.service';

/**
 * The staff supplies checklist in Telegram: what is on it, what a tap does,
 * and what Send hands to the buy list. The buy list's own rules are proven in
 * station-request.service.spec.ts (addRequested).
 */
describe('TelegramOrdersService', () => {
  const ANA: OrderingPerson = { userId: 'ana', name: 'Ana', role: 'GENERAL_EMPLOYEE', tenantId: 't1', shopName: 'Cafe Carolina', branchId: 'b1' };

  function build(opts: { branches?: Array<{ id: string; name: string }> } = {}) {
    const materials = [
      { id: 'bleach', name: 'Bleach', category: 'KITCHEN_SUPPLY', lowStockAlert: 2, isActive: true, prep: false },
      { id: 'tissue', name: 'Tissue roll', category: 'KITCHEN_SUPPLY', lowStockAlert: null, isActive: true, prep: false },
      { id: 'milk', name: 'Fresh Milk', category: 'INGREDIENT', lowStockAlert: 1000, isActive: true, prep: false },
    ];
    const prisma: any = {
      branch: { findMany: jest.fn(async () => opts.branches ?? [{ id: 'b1', name: 'Main' }]) },
      rawMaterial: {
        findMany: jest.fn(async ({ where }: any) => materials
          .filter((m) => m.isActive && where.category.in.includes(m.category) && !m.prep)
          .map((m) => ({ id: m.id, name: m.name, lowStockAlert: m.lowStockAlert }))),
        findFirst: jest.fn(async ({ where }: any) => {
          const m = materials.find((x) => x.name.toLowerCase() === String(where.name.equals).toLowerCase());
          return m ? { id: m.id, name: m.name, category: m.category, isActive: m.isActive, subRecipeItems: m.prep ? [{ id: 'x' }] : [] } : null;
        }),
      },
      rawMaterialInventory: { findMany: jest.fn(async () => [{ rawMaterialId: 'bleach', quantity: 1 }, { rawMaterialId: 'tissue', quantity: 9 }]) },
    };
    const requests = { addRequested: jest.fn(async () => ({ requestNumber: 'REQ-1', status: 'OPEN', added: [], raised: [], kept: [] })) };
    const sent: Array<{ chatId: string; text: string; markup?: any }> = [];
    const client: any = {
      sendMessage: jest.fn((chatId: string, text: string, markup?: any) => { sent.push({ chatId, text, markup }); }),
      editMessage: jest.fn(async () => true),
      answerCallback: jest.fn(),
    };
    const links: any = { setOrderDesk: jest.fn() };
    const svc = new TelegramOrdersService(prisma, requests as any, links, client);
    return { svc, prisma, requests, client, sent, links };
  }

  it('registers itself with the bot', () => {
    const { svc, links } = build();
    svc.onModuleInit();
    expect(links.setOrderDesk).toHaveBeenCalledWith(svc);
  });

  it('/order shows supplies only, the low one first, nothing ticked', async () => {
    const { svc, sent } = build();
    await svc.open('5005', ANA);
    expect(sent[0].text).toContain('Supplies for Cafe Carolina');
    const rows = sent[0].markup.inline_keyboard;
    expect(rows.map((r: any) => r[0].text)).toEqual(['▫️ Bleach (low)', '▫️ Tissue roll', '📤 Send']);
    expect(JSON.stringify(rows)).not.toContain('milk');
  });

  it('a tap adds one and redraws the checklist with the count in it', async () => {
    const { svc, client } = build();
    const markup = buildKeyboard([{ id: 'bleach', name: 'Bleach', low: true }, { id: 'tissue', name: 'Tissue roll', low: false }], new Map([['bleach', 1]]));
    await svc.tap({ id: 'cb', data: 'o+:bleach', message: { message_id: 7, chat: { id: '5005', type: 'private' }, reply_markup: markup } }, '5005', ANA);
    const redrawn = client.editMessage.mock.calls[0][3];
    expect(readCounts(redrawn).get('bleach')).toBe(2);
    expect(client.answerCallback).toHaveBeenCalledWith('cb');
  });

  it('Send hands what was ticked to the buy list in Ana\'s name and closes the checklist', async () => {
    const { svc, client, requests } = build();
    const markup = buildKeyboard([{ id: 'bleach', name: 'Bleach', low: true }, { id: 'tissue', name: 'Tissue roll', low: false }], new Map([['bleach', 2]]));
    await svc.tap({ id: 'cb', data: 'os', message: { message_id: 7, chat: { id: '5005', type: 'private' }, reply_markup: markup } }, '5005', ANA);
    expect(requests.addRequested).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', branchId: 'b1', actorId: 'ana', byLabel: 'Ana (Telegram)' }),
      [{ rawMaterialId: 'bleach', qty: 2 }], 'Ana');
    const [, , text, keyboard] = client.editMessage.mock.calls[0];
    expect(text).toContain('Bleach ×2');
    expect(text).toContain('end-of-day buy list');
    expect(keyboard).toBeUndefined();
  });

  it('Send with nothing ticked sends nothing', async () => {
    const { svc, client, requests } = build();
    const markup = buildKeyboard([{ id: 'bleach', name: 'Bleach', low: true }], new Map());
    await svc.tap({ id: 'cb', data: 'os', message: { message_id: 7, chat: { id: '5005' }, reply_markup: markup } }, '5005', ANA);
    expect(requests.addRequested).not.toHaveBeenCalled();
    expect(client.answerCallback).toHaveBeenCalledWith('cb', 'Tick at least one item first.');
  });

  it('a count for an item that is no longer a supply is dropped, not sent', async () => {
    const { svc, requests } = build();
    const markup = buildKeyboard([{ id: 'milk', name: 'Fresh Milk', low: false }, { id: 'tissue', name: 'Tissue roll', low: false }], new Map([['milk', 3], ['tissue', 1]]));
    await svc.tap({ id: 'cb', data: 'os', message: { message_id: 7, chat: { id: '5005' }, reply_markup: markup } }, '5005', ANA);
    expect((requests.addRequested.mock.calls[0] as any[])[1]).toEqual([{ rawMaterialId: 'tissue', qty: 1 }]);
  });

  it('/need adds a supply by name, or a new one; an ingredient is refused', async () => {
    const { svc, requests, sent } = build();
    await svc.need('5005', ANA, '/need tissue roll, 3');
    expect((requests.addRequested.mock.calls[0] as any[])[1]).toEqual([{ rawMaterialId: 'tissue', qty: 3 }]);
    await svc.need('5005', ANA, '/need Sponge 2');
    expect((requests.addRequested.mock.calls[1] as any[])[1]).toEqual([{ newItem: { name: 'Sponge', category: 'KITCHEN_SUPPLY', unit: 'pc' }, qty: 2 }]);
    expect(sent.at(-1)!.text).toContain('new to Clerque');
    await svc.need('5005', ANA, '/need fresh milk, 2');
    expect(requests.addRequested).toHaveBeenCalledTimes(2);
    expect(sent.at(-1)!.text).toContain('is an ingredient');
  });

  it('a shop with two branches and a person with none set is asked to sort the branch out', async () => {
    const { svc, sent, requests } = build({ branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Mall' }] });
    await svc.open('5005', { ...ANA, branchId: null });
    await svc.need('5005', { ...ANA, branchId: null }, '/need Bleach, 1');
    expect(sent.map((m) => m.text)).toEqual([expect.stringContaining('which branch'), expect.stringContaining('which branch')]);
    expect(requests.addRequested).not.toHaveBeenCalled();
  });
});
