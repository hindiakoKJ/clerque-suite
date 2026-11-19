import { ForbiddenException } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';

/**
 * Who counts does not post. A count is where shrinkage is found or hidden,
 * so the person who typed the counted figures cannot also move the stock and
 * the books by them -- not even the owner. And no API key posts a count at
 * all: one may only open it (/service/inventory/drafts/count).
 */
describe('WarehouseService — segregation of duties on counts', () => {
  const T = 't1';

  function build(lines: any[]) {
    /* Reaching the branch post lock means every check before it passed. */
    const pastTheChecks = new Error('PAST_THE_CHECKS');
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockRejectedValue(pastTheChecks),
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cc1', tenantId: T, branchId: 'b1', status: 'OPEN', createdAt: new Date(), lines }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      cycleCountLine: {
        findFirst: jest.fn().mockResolvedValue({ id: 'l1', expectedQty: '8' }),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: 'l1', ...data })),
      },
    };
    return { svc: new WarehouseService(prisma), prisma, tx };
  }

  const line = (id: string, rm: string, countedById: string | null) =>
    ({ id, rawMaterialId: rm, countedQty: '7.5', expectedQty: '8', countedById, notes: null, rawMaterial: { id: rm } });

  it('the counts screen records who entered a figure', async () => {
    const { svc, prisma } = build([]);
    await svc.setLineCount(T, 'l1', 7.5, 'u_counter');
    expect(prisma.cycleCountLine.update.mock.calls[0][0].data).toMatchObject({ countedById: 'u_counter' });
  });

  it('refuses the post to the person who entered the counts', async () => {
    const { svc } = build([line('l1', 'milk', 'u_counter'), line('l2', 'beans', 'u_other')]);
    await expect(svc.postCycleCount(T, 'cc1', 'u_counter')).rejects.toThrow(
      'Segregation of duties: you entered 1 of this count\'s figures, so someone else has to post it.',
    );
  });

  it('refuses the owner too: there is no override', async () => {
    const { svc } = build([line('l1', 'milk', 'u_owner')]);
    await expect(svc.postCycleCount(T, 'cc1', 'u_owner')).rejects.toThrow(ForbiddenException);
  });

  it('lets someone who did not count post it', async () => {
    const { svc } = build([line('l1', 'milk', 'u_counter')]);
    await expect(svc.postCycleCount(T, 'cc1', 'u_manager')).rejects.toThrow('PAST_THE_CHECKS');
  });

  it('does not hold lines from before the change (nobody recorded) against anyone', async () => {
    const { svc } = build([line('l1', 'milk', null)]);
    await expect(svc.postCycleCount(T, 'cc1', 'u_owner')).rejects.toThrow('PAST_THE_CHECKS');
  });

  it('ignores a line the post leaves out (a weekly review skipping an item counted again)', async () => {
    const { svc } = build([line('l1', 'milk', 'u_owner'), line('l2', 'beans', null)]);
    await expect(svc.postCycleCount(T, 'cc1', 'u_owner', false, ['milk'])).rejects.toThrow('PAST_THE_CHECKS');
  });

  it('never lets an API key post a count', async () => {
    const { svc } = build([line('l1', 'milk', null)]);
    await expect(svc.postCycleCount(T, 'cc1', 'apikey:key1')).rejects.toThrow('A count is posted by a person signed in to Clerque.');
    await expect(svc.postCycleCount(T, 'cc1', '')).rejects.toThrow(ForbiddenException);
  });
});
