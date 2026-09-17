import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { STATION_ROLES } from '../kds/station-access';
import { StationPrepMadeController } from './station-prep-made.controller';

/**
 * "Made" on a station screen's prep chain card: who may record which stage,
 * at which branch, and that a tap is recorded once and says nothing about cost.
 *
 * A kitchen tablet records for the branch of whoever paired it; a barista
 * logged in on the kitchen screen may not record the kitchen's sauce; and a
 * double-tap reaches makeBatch with the same key both times, so it is
 * recorded once there.
 */
describe('StationPrepMadeController', () => {
  const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
  const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
  const KEY = 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  function build(opts: { pairerActive?: boolean; board?: any[]; made?: any } = {}) {
    const prisma: any = {
      station: {
        findFirst: jest.fn(async ({ where }: any) => {
          const s = where.tenantId === 't1' ? [KITCHEN, BAR].find((x) => x.id === where.id) : null;
          return s ? { ...s, branchId: null } : null;
        }),
        // The shop's own stations, for the persona check a logged-in person gets.
        findMany: jest.fn(async () => [{ kind: 'KITCHEN' }, { kind: 'BAR' }]),
      },
      user: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.tenantId !== 't1') return null;
          if (where.id === 'mgr') return { id: 'mgr', name: 'Mia', branchId: 'b-B', isActive: opts.pairerActive ?? true };
          if (where.id === 'barista') return { id: 'barista', name: 'Bea', branchId: 'b-main', isActive: true };
          if (where.id === 'cook') return { id: 'cook', name: 'Jo', branchId: 'b-main', isActive: true };
          return null;
        }),
      },
      branch: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id ?? 'b-first', name: where.id === 'b-B' ? 'Mall' : 'Main' })) },
    };
    const board = opts.board ?? [
      { id: 'ready', name: 'Tomato Sauce (ready)', unit: 'g', station: KITCHEN, costPrice: 0.12 },
      { id: 'syrup', name: 'Vanilla Syrup', unit: 'ml', station: BAR, costPrice: 0.3 },
      { id: 'loose', name: 'House Stock', unit: 'g', station: null, costPrice: 0.05 },
    ];
    const subRecipes: any = {
      list: jest.fn(async () => board),
      // makeBatch hands back costs too; the screen must never see them.
      makeBatch: jest.fn(async (_t: string, rawMaterialId: string) => opts.made ?? {
        rawMaterialId, branchId: 'b-B', produced: 2000, unitCost: 0.11, inputValue: 220, yieldVariance: null, lotId: 'lot-1',
      }),
    };
    return { ctl: new StationPrepMadeController(subRecipes, prisma), subRecipes, prisma };
  }
  const device = (over: any = {}) => ({ sub: 'mgr', tenantId: 't1', branchId: null, isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY', ...over });
  const person = (over: any = {}) => ({ sub: 'cook', tenantId: 't1', branchId: 'b-main', role: 'GENERAL_EMPLOYEE', personaKey: 'LINE_COOK', ...over });

  /** Every key anywhere in a response, however deep. */
  const keysOf = (v: unknown): string[] => (v && typeof v === 'object'
    ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keysOf(x)])
    : []);

  it('a kitchen tablet records one batch at its own station, for the branch of whoever paired it, keyed on the tap', async () => {
    const { ctl, subRecipes } = build();
    const res = await ctl.made(device() as any, 's-kitchen', 'ready', { key: KEY });
    expect(subRecipes.list).toHaveBeenCalledWith('t1', 'b-B', null);
    expect(subRecipes.makeBatch).toHaveBeenCalledWith(
      't1', 'ready', { branchId: 'b-B', batches: 1, stationId: 's-kitchen', referenceNumber: `STN-${KEY}` }, 'mgr', null,
    );
    expect(res).toEqual({
      rawMaterialId: 'ready', name: 'Tomato Sauce (ready)', produced: 2000, unit: 'g', duplicate: false,
      message: 'Recorded: 1 batch of Tomato Sauce (ready), 2,000 g.',
    });
  });

  it('puts no cost, price or value anywhere in the response', async () => {
    const { ctl } = build();
    const res = await ctl.made(device() as any, 's-kitchen', 'ready', { key: KEY });
    expect(keysOf(res).filter((k) => /cost|price|value/i.test(k))).toEqual([]);
  });

  it('a second tap with the same key is told it was already recorded', async () => {
    const { ctl } = build({ made: { rawMaterialId: 'ready', branchId: 'b-B', produced: 2000, duplicate: true, message: 'This batch was already recorded. Nothing was made again.' } });
    const res = await ctl.made(device() as any, 's-kitchen', 'ready', { key: KEY });
    expect(res).toEqual({
      rawMaterialId: 'ready', name: 'Tomato Sauce (ready)', produced: 2000, unit: 'g', duplicate: true,
      message: 'Already recorded. Nothing was made again.',
    });
  });

  it('a logged-in person records under their own name and persona, at their own branch', async () => {
    const { ctl, subRecipes } = build();
    await ctl.made(person() as any, 's-kitchen', 'ready', { key: KEY });
    expect(subRecipes.makeBatch).toHaveBeenCalledWith(
      't1', 'ready', { branchId: 'b-main', batches: 1, stationId: 's-kitchen', referenceNumber: `STN-${KEY}` }, 'cook', 'LINE_COOK',
    );
  });

  it('refuses a tablet paired to another station, an unpaired screen and the customer display', async () => {
    const { ctl, subRecipes } = build();
    await expect(ctl.made(device() as any, 's-bar', 'syrup', { key: KEY })).rejects.toThrow('This screen is paired to another station.');
    await expect(ctl.made(device({ stationId: null }) as any, 's-kitchen', 'ready', { key: KEY })).rejects.toThrow('not paired to a station');
    await expect(ctl.made(device({ deviceRole: 'CUSTOMER_DISPLAY', stationId: null }) as any, 's-kitchen', 'ready', { key: KEY }))
      .rejects.toThrow('Only a kitchen or bar display can use this.');
    expect(subRecipes.makeBatch).not.toHaveBeenCalled();
  });

  it('refuses a write from a tablet paired by someone who has since left', async () => {
    const { ctl, subRecipes } = build({ pairerActive: false });
    await expect(ctl.made(device() as any, 's-kitchen', 'ready', { key: KEY })).rejects.toThrow('no longer has an active account');
    expect(subRecipes.makeBatch).not.toHaveBeenCalled();
  });

  it('refuses another station\'s prep with a 403 that says where to record it', async () => {
    const { ctl, subRecipes } = build();
    const bar = device({ deviceRole: 'KDS_BAR', stationId: 's-bar' });
    const err = await ctl.made(bar as any, 's-bar', 'ready', { key: KEY }).catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toBe('Tomato Sauce (ready) is a Kitchen item. Record it on the Kitchen screen.');
    expect(subRecipes.makeBatch).not.toHaveBeenCalled();
  });

  it('a barista logged in on the kitchen screen may not record the kitchen\'s sauce', async () => {
    const { ctl, subRecipes } = build();
    const err = await ctl.made(person({ sub: 'barista', personaKey: 'BARISTA' }) as any, 's-kitchen', 'ready', { key: KEY }).catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(subRecipes.makeBatch).not.toHaveBeenCalled();
  });

  it('an item routed to no station may be recorded from any station screen', async () => {
    const { ctl, subRecipes } = build();
    const bar = device({ deviceRole: 'KDS_BAR', stationId: 's-bar' });
    await expect(ctl.made(bar as any, 's-bar', 'loose', { key: KEY })).resolves.toMatchObject({ rawMaterialId: 'loose', duplicate: false });
    expect(subRecipes.makeBatch.mock.calls[0][2]).toMatchObject({ stationId: 's-bar', batches: 1 });
  });

  it('an item not on the board is a 404', async () => {
    const { ctl, subRecipes } = build();
    const err = await ctl.made(device() as any, 's-kitchen', 'gone', { key: KEY }).catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.message).toBe('That pre-made item was not found.');
    expect(subRecipes.makeBatch).not.toHaveBeenCalled();
  });

  it('needs a tap key of 8 to 64 letters, digits or dashes', async () => {
    const { ctl, subRecipes } = build();
    for (const body of [undefined, {}, { key: '' }, { key: 'short' }, { key: 'has spaces in it' }, { key: 'x'.repeat(65) }, { key: 12345678 }, { key: 'semi;colon1' }]) {
      await expect(ctl.made(device() as any, 's-kitchen', 'ready', body as any)).rejects.toThrow('Missing tap key.');
    }
    expect(subRecipes.makeBatch).not.toHaveBeenCalled();
    // The browser fallback key (base-36 time and random) passes.
    await expect(ctl.made(device() as any, 's-kitchen', 'ready', { key: 'lx3k9a2bq4w8e7r1' })).resolves.toMatchObject({ duplicate: false });
  });

  it('passes makeBatch\'s own refusals through unchanged', async () => {
    const { ctl, subRecipes } = build();
    subRecipes.makeBatch.mockRejectedValueOnce(new BadRequestException('Not enough Tomato: 1 batch(es) needs 2000 g, and there is 0. Receive more before recording this.'));
    await expect(ctl.made(device() as any, 's-kitchen', 'ready', { key: KEY })).rejects.toThrow('Not enough Tomato');
  });

  it('is open to every station role and answers 200', () => {
    const handler = StationPrepMadeController.prototype.made;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([...STATION_ROLES]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });
});
