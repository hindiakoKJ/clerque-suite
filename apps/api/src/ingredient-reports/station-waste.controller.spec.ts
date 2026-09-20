import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { STATION_ROLES } from '../kds/station-access';
import { IngredientReportsModule } from './ingredient-reports.module';
import { InventoryModule } from '../inventory/inventory.module';
import { StationWasteController } from './station-waste.controller';
import { stationItems } from './station-items';

// Which items are on which station has its own spec; here only that the route asks it and obeys.
jest.mock('./station-items', () => ({
  ...jest.requireActual('./station-items'),
  stationItems: jest.fn(),
}));

/**
 * "Thrown out" on a kitchen or bar screen: who may record waste for which
 * item, that it goes through the same write-off as Procure > Stock, that a tap
 * is taken off once, and that the answer carries no cost.
 */
describe('StationWasteController', () => {
  const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
  const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
  const KEY = 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  function build(opts: { pairerActive?: boolean; onHand?: Record<string, number>; seenLot?: boolean; writeOff?: any } = {}) {
    const onHand = opts.onHand ?? { milk: 3000, fries: 5000, syrup: 900, napkins: 400 };
    const prisma: any = {
      station: {
        findFirst: jest.fn(async ({ where }: any) => {
          const s = where.tenantId === 't1' ? [KITCHEN, BAR].find((x) => x.id === where.id) : null;
          return s ? { ...s, branchId: null } : null;
        }),
      },
      user: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.tenantId !== 't1') return null;
          if (where.id === 'mgr') return { id: 'mgr', name: 'Mia', branchId: 'b-B', isActive: opts.pairerActive ?? true };
          if (where.id === 'cook') return { id: 'cook', name: 'Jo', branchId: 'b-main', isActive: true };
          return null;
        }),
      },
      branch: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id ?? 'b-first', name: where.id === 'b-B' ? 'Mall' : 'Main' })) },
      rawMaterialLot: { findFirst: jest.fn(async () => (opts.seenLot ? { id: 'lot-waste' } : null)) },
      rawMaterialInventory: {
        findUnique: jest.fn(async ({ where }: any) => {
          const id = where.branchId_rawMaterialId.rawMaterialId;
          return id in onHand ? { quantity: onHand[id] } : null;
        }),
      },
    };
    (stationItems as jest.Mock).mockResolvedValue({
      stations: [KITCHEN, BAR],
      items: new Map<string, any>([
        ['fries',   { name: 'Frozen Fries', unit: 'g', category: 'INGREDIENT', isPrep: false, on: new Set(['s-kitchen']) }],
        ['milk',    { name: 'Fresh Milk', unit: 'ml', category: 'INGREDIENT', isPrep: false, on: new Set(['s-kitchen', 's-bar']) }],
        ['syrup',   { name: 'Vanilla Syrup', unit: 'ml', category: 'INGREDIENT', isPrep: false, on: new Set(['s-bar']) }],
        // Used only by a product routed nowhere: on every station's sheet, under "Not routed to a station".
        ['napkins', { name: 'Napkins', unit: 'pc', category: 'INGREDIENT', isPrep: false, on: new Set(['UNROUTED']) }],
        // On no sheet at all.
        ['bleach',  { name: 'Bleach', unit: 'ml', category: 'OFFICE_SUPPLY', isPrep: false, on: new Set() }],
      ]),
    });
    const inventory: any = {
      // The write-off also hands back the unit cost and value; the screen must never see them.
      writeOffRawMaterial: jest.fn(async (_t: string, rawMaterialId: string, _u: string, dto: any) => opts.writeOff ?? {
        rawMaterialId, branchId: dto.branchId, quantityBefore: 3000, quantityAfter: 3000 - dto.quantity, quantity: dto.quantity,
        reasonCode: dto.reasonCode, unitCost: 0.09, totalValue: dto.quantity * 0.09, warning: null, heldQty: 0, heldWarning: null,
      }),
    };
    return { ctl: new StationWasteController(prisma, inventory), inventory, prisma };
  }
  const device = (over: any = {}) => ({ sub: 'mgr', tenantId: 't1', branchId: null, isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY', ...over });
  const person = (over: any = {}) => ({ sub: 'cook', tenantId: 't1', branchId: 'b-main', role: 'GENERAL_EMPLOYEE', personaKey: 'LINE_COOK', ...over });
  const entry = (over: any = {}) => ({ rawMaterialId: 'milk', qty: 500, reason: 'SPOILED', key: KEY, ...over });

  /** Every key anywhere in a response, however deep. */
  const keysOf = (v: unknown): string[] => (v && typeof v === 'object'
    ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keysOf(x)])
    : []);

  beforeEach(() => jest.clearAllMocks());

  it('is POST /kds/stations/:id/waste, for a paired screen or a login with the station roles, answering 200', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StationWasteController)).toBe('kds');
    expect(Reflect.getMetadata(GUARDS_METADATA, StationWasteController)).toEqual([JwtOrDeviceTokenAuthGuard, RolesGuard]);
    const handler = StationWasteController.prototype.waste;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('stations/:id/waste');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([...STATION_ROLES]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });

  it('is served by the ingredient reports module, which brings the write-off with it', () => {
    expect(Reflect.getMetadata('controllers', IngredientReportsModule)).toContain(StationWasteController);
    expect(Reflect.getMetadata('imports', IngredientReportsModule)).toContain(InventoryModule);
  });

  it('a kitchen tablet writes spoiled milk off through the same write-off as Procure, for the branch of whoever paired it', async () => {
    const { ctl, inventory } = build();
    const res = await ctl.waste(device() as any, 's-kitchen', entry());
    expect(inventory.writeOffRawMaterial).toHaveBeenCalledWith('t1', 'milk', 'mgr', {
      branchId: 'b-B', quantity: 500, reasonCode: 'DAMAGE', note: 'Kitchen screen: thrown out, spoiled', referenceNumber: `WASTE-${KEY}`,
    });
    expect(res).toEqual({
      rawMaterialId: 'milk', name: 'Fresh Milk', quantity: 500, unit: 'ml', reason: 'SPOILED', duplicate: false, warning: null,
      message: 'Recorded: 500 ml of Fresh Milk thrown out (spoiled).',
    });
  });

  it('puts no cost, price or value anywhere in the answer', async () => {
    const { ctl } = build();
    const res = await ctl.waste(device() as any, 's-kitchen', entry());
    expect(keysOf(res).filter((k) => /cost|price|value/i.test(k))).toEqual([]);
  });

  it('books each reason as waste the way Procure does, with the note in the cook\'s words', async () => {
    const { ctl, inventory } = build();
    await ctl.waste(device() as any, 's-kitchen', entry({ reason: 'EXPIRED' }));
    await ctl.waste(device() as any, 's-kitchen', entry({ reason: 'DROPPED', rawMaterialId: 'fries', qty: 1500, note: '  fell off the tray  ' }));
    await ctl.waste(device() as any, 's-kitchen', entry({ reason: 'OTHER', note: 'x'.repeat(400) }));
    const calls = inventory.writeOffRawMaterial.mock.calls.map((c: any[]) => c[3]);
    expect(calls.map((d: any) => d.reasonCode)).toEqual(['EXPIRY', 'DAMAGE', 'OTHER']);
    expect(calls[0].note).toBe('Kitchen screen: thrown out, past its date');
    expect(calls[1].note).toBe('Kitchen screen: thrown out, dropped or spilled (fell off the tray)');
    // Capped, so the write-off's own 500-character note always fits.
    expect(calls[2].note).toBe(`Kitchen screen: thrown out, other (${'x'.repeat(200)})`);
  });

  it('a logged-in person records under their own name, at their own branch', async () => {
    const { ctl, inventory } = build();
    const res = await ctl.waste(person() as any, 's-kitchen', entry({ rawMaterialId: 'fries', qty: 1500 }));
    expect(inventory.writeOffRawMaterial).toHaveBeenCalledWith('t1', 'fries', 'cook', expect.objectContaining({
      branchId: 'b-main', quantity: 1500, note: 'Jo: thrown out, spoiled',
    }));
    expect(res.message).toBe('Recorded: 1.5 kg of Frozen Fries thrown out (spoiled).');
  });

  it('refuses an item that is not on this station\'s sheet, and says who can write it off', async () => {
    const { ctl, inventory } = build();
    const err = await ctl.waste(device() as any, 's-kitchen', entry({ rawMaterialId: 'syrup' })).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('That item is not on the Kitchen sheet. Ask the manager to write it off in Procure > Stock.');
    await expect(ctl.waste(device() as any, 's-kitchen', entry({ rawMaterialId: 'bleach' }))).rejects.toThrow(ForbiddenException);
    // Not an item of this shop, or switched off: not on any sheet either.
    await expect(ctl.waste(device() as any, 's-kitchen', entry({ rawMaterialId: 'someone-elses' }))).rejects.toThrow(ForbiddenException);
    expect(inventory.writeOffRawMaterial).not.toHaveBeenCalled();
  });

  it('allows an item on both sheets from either screen, and an item only unrouted dishes use', async () => {
    const { ctl, inventory } = build();
    await ctl.waste(device({ deviceRole: 'KDS_BAR', stationId: 's-bar' }) as any, 's-bar', entry({ rawMaterialId: 'milk' }));
    await ctl.waste(device({ deviceRole: 'KDS_BAR', stationId: 's-bar' }) as any, 's-bar', entry({ rawMaterialId: 'syrup', qty: 100 }));
    await ctl.waste(device() as any, 's-kitchen', entry({ rawMaterialId: 'napkins', qty: 20 }));
    expect(inventory.writeOffRawMaterial.mock.calls.map((c: any[]) => [c[1], c[3].note])).toEqual([
      ['milk', 'Bar screen: thrown out, spoiled'],
      ['syrup', 'Bar screen: thrown out, spoiled'],
      ['napkins', 'Kitchen screen: thrown out, spoiled'],
    ]);
  });

  it('refuses a tablet paired to another station, an unpaired screen, the customer display and a pairer who has left', async () => {
    const { ctl, inventory } = build();
    await expect(ctl.waste(device() as any, 's-bar', entry())).rejects.toThrow('This screen is paired to another station.');
    await expect(ctl.waste(device({ stationId: null }) as any, 's-kitchen', entry())).rejects.toThrow('not paired to a station');
    await expect(ctl.waste(device({ deviceRole: 'CUSTOMER_DISPLAY', stationId: null }) as any, 's-kitchen', entry()))
      .rejects.toThrow('Only a kitchen or bar display can use this.');
    const left = build({ pairerActive: false });
    await expect(left.ctl.waste(device() as any, 's-kitchen', entry())).rejects.toThrow('no longer has an active account');
    expect(inventory.writeOffRawMaterial).not.toHaveBeenCalled();
    expect(left.inventory.writeOffRawMaterial).not.toHaveBeenCalled();
  });

  it('a retry of an entry that went through is told it was already recorded, and nothing is taken off again', async () => {
    const { ctl, inventory } = build({ seenLot: true, onHand: { milk: 0 } });
    const res = await ctl.waste(device() as any, 's-kitchen', entry());
    expect(res).toMatchObject({ duplicate: true, message: 'Already recorded. Nothing was taken off again.' });
    expect(inventory.writeOffRawMaterial).not.toHaveBeenCalled();
  });

  it('two taps racing past the first look: the write-off\'s own "already written off" reads the same', async () => {
    const { ctl } = build({ writeOff: { duplicate: true, rawMaterialId: 'milk', quantity: 0, message: 'Already written off.' } });
    const res = await ctl.waste(device() as any, 's-kitchen', entry());
    expect(res).toEqual({
      rawMaterialId: 'milk', name: 'Fresh Milk', quantity: 500, unit: 'ml', reason: 'SPOILED', duplicate: true, warning: null,
      message: 'Already recorded. Nothing was taken off again.',
    });
  });

  it('more than the books hold is refused in the kitchen\'s words, before anything is written', async () => {
    const { ctl, inventory } = build({ onHand: { milk: 1200, fries: 0 } });
    await expect(ctl.waste(device() as any, 's-kitchen', entry({ qty: 2000 })))
      .rejects.toThrow(new BadRequestException('The books show only 1.2 L of Fresh Milk here. Enter up to that, and tell the manager so the count can be fixed.'));
    await expect(ctl.waste(device() as any, 's-kitchen', entry({ rawMaterialId: 'fries', qty: 10 })))
      .rejects.toThrow('The books show no Frozen Fries here. Tell the manager so the count can be fixed.');
    expect(inventory.writeOffRawMaterial).not.toHaveBeenCalled();
  });

  it('passes on the warning about orders still waiting, which is quantities only', async () => {
    const heldWarning = '300 ml of "Fresh Milk" is for orders still waiting at the kitchen or bar, and this leaves 200 ml. Check those orders can still be made.';
    const { ctl } = build({ writeOff: { rawMaterialId: 'milk', quantityAfter: 200, unitCost: 0.09, totalValue: 45, warning: null, heldQty: 300, heldWarning } });
    const res = await ctl.waste(device() as any, 's-kitchen', entry());
    expect(res.warning).toBe(heldWarning);
  });

  it('refuses a missing tap key, item, amount or reason with nothing written', async () => {
    const { ctl, inventory } = build();
    await expect(ctl.waste(device() as any, 's-kitchen', entry({ key: undefined }))).rejects.toThrow('Missing tap key.');
    await expect(ctl.waste(device() as any, 's-kitchen', undefined)).rejects.toThrow('Missing tap key.');
    await expect(ctl.waste(device() as any, 's-kitchen', entry({ rawMaterialId: '' }))).rejects.toThrow('Pick the item that was thrown out.');
    for (const qty of [0, -5, '500', Number.NaN, null]) {
      await expect(ctl.waste(device() as any, 's-kitchen', entry({ qty }))).rejects.toThrow('Enter how much was thrown out.');
    }
    for (const reason of [undefined, 'THEFT', 'DAMAGE', 'toString']) {
      await expect(ctl.waste(device() as any, 's-kitchen', entry({ reason }))).rejects.toThrow('Pick why it was thrown out');
    }
    expect(inventory.writeOffRawMaterial).not.toHaveBeenCalled();
  });
});
