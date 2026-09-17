import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { STATION_ROLES } from '../kds/station-access';
import { RequestLowDto, StationRequestController } from './station-request.controller';

/**
 * Who may ask for what is running low from a station screen, and whose branch
 * and name the request carries. A kitchen tablet asks for the branch of the
 * person who paired it and is named "Kitchen screen"; a person logged in on
 * the screen is named themselves.
 */
describe('StationRequestController', () => {
  function build(opts: { pairerActive?: boolean } = {}) {
    const prisma: any = {
      station: {
        findFirst: jest.fn(async ({ where }: any) => (where.tenantId === 't1' && ['s-kitchen', 's-bar'].includes(where.id)
          ? { id: where.id, name: where.id === 's-kitchen' ? 'Kitchen' : 'Bar', kind: where.id === 's-kitchen' ? 'KITCHEN' : 'BAR', branchId: null }
          : null)),
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
    };
    const requests: any = {
      apply: jest.fn(async () => ({ outcome: 'SENT' })),
      preview: jest.fn(async () => ({ pickable: [] })),
    };
    return { ctl: new StationRequestController(prisma, requests), requests };
  }
  const device = (over: any = {}) => ({ sub: 'mgr', tenantId: 't1', branchId: null, isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY', ...over });
  const person = { sub: 'cook', tenantId: 't1', branchId: 'b-main', role: 'GENERAL_EMPLOYEE' };

  it('a kitchen tablet asks for the branch of whoever paired it, named as the screen', async () => {
    const { ctl, requests } = build();
    await ctl.request(device() as any, 's-kitchen', { extras: [] });
    expect(requests.apply).toHaveBeenCalledWith({
      tenantId: 't1', branchId: 'b-B', branchName: 'Mall', stationKind: 'KITCHEN', stationName: 'Kitchen',
      actorId: 'mgr', createdById: 'mgr', byLabel: 'Kitchen screen', source: 'STATION',
    }, [], expect.any(Date));
  });

  it('a person logged in on the screen asks for their own branch, under their own name', async () => {
    const { ctl, requests } = build();
    await ctl.request(person as any, 's-bar', {});
    expect(requests.apply.mock.calls[0][0]).toMatchObject({ branchId: 'b-main', stationKind: 'BAR', actorId: 'cook', byLabel: 'Jo' });
  });

  it('refuses another station, an unpaired screen and the customer display', async () => {
    const { ctl, requests } = build();
    await expect(ctl.request(device() as any, 's-bar', {})).rejects.toThrow('This screen is paired to another station.');
    await expect(ctl.request(device({ stationId: null }) as any, 's-kitchen', {})).rejects.toThrow('not paired to a station');
    await expect(ctl.preview(device({ deviceRole: 'CUSTOMER_DISPLAY', stationId: null }) as any, 's-kitchen')).rejects.toThrow('Only a kitchen or bar display can use this.');
    expect(requests.apply).not.toHaveBeenCalled();
    expect(requests.preview).not.toHaveBeenCalled();
  });

  it('a screen paired by someone who has left may look, but not send', async () => {
    const { ctl, requests } = build({ pairerActive: false });
    await expect(ctl.preview(device() as any, 's-kitchen')).resolves.toEqual({ pickable: [] });
    await expect(ctl.request(device() as any, 's-kitchen', {})).rejects.toThrow('no longer has an active account');
    expect(requests.apply).not.toHaveBeenCalled();
  });

  it('an added item is either picked or new, not both', async () => {
    const { ctl } = build();
    await expect(ctl.request(device() as any, 's-kitchen', { extras: [{ qty: 1 } as any] })).rejects.toThrow('either an item from the list or a new item');
  });

  it('every station role may use both routes', () => {
    for (const handler of [StationRequestController.prototype.preview, StationRequestController.prototype.request]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([...STATION_ROLES]);
    }
  });

  describe('the body', () => {
    const check = async (body: unknown) => (await validate(plainToInstance(RequestLowDto, body), { whitelist: true, forbidNonWhitelisted: true }))
      .flatMap(function flat(e): string[] { return [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap(flat)]; });

    it('takes up to 20 extras with a positive amount', async () => {
      expect(await check({ extras: [{ rawMaterialId: 'rm1', qty: 2 }, { newItem: { name: ' Tissue roll ', category: 'KITCHEN_SUPPLY', unit: 'roll' }, qty: 10 }] })).toEqual([]);
      expect(await check({ extras: Array.from({ length: 21 }, () => ({ rawMaterialId: 'rm1', qty: 1 })) })).not.toEqual([]);
      expect(await check({ extras: [{ rawMaterialId: 'rm1', qty: 0 }] })).not.toEqual([]);
      expect(await check({ extras: [{ rawMaterialId: 'rm1', qty: 1_000_001 }] })).not.toEqual([]);
    });

    it('a new item is a supply with a known unit and a real name', async () => {
      expect(await check({ extras: [{ newItem: { name: 'Oat milk', category: 'INGREDIENT', unit: 'ml' }, qty: 1 }] })).not.toEqual([]);
      expect(await check({ extras: [{ newItem: { name: 'Cups', category: 'BAR_SUPPLY', unit: 'sack' }, qty: 1 }] })).not.toEqual([]);
      expect(await check({ extras: [{ newItem: { name: ' x ', category: 'BAR_SUPPLY', unit: 'pc' }, qty: 1 }] })).not.toEqual([]);
      expect(await check({ extras: [{ newItem: { name: 'y'.repeat(81), category: 'BAR_SUPPLY', unit: 'pc' }, qty: 1 }] })).not.toEqual([]);
      expect(await check({ extras: [{ newItem: { name: 'Straws', category: 'BAR_SUPPLY', unit: 'L' }, qty: 1, costPrice: 5 }] })).not.toEqual([]);
    });
  });
});
