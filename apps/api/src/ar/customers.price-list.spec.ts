/**
 * Ledger > Customers — the form always sends `priceListId` (null = default
 * pricing). The DTO did not declare it, so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) rejected EVERY create and edit with
 * "property priceListId should not exist".
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';

// Same options as apps/api/src/main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

describe('Customer DTOs accept the form payload', () => {
  it('create: priceListId null (default pricing) passes', async () => {
    const out = await pipe.transform(
      { name: 'Walk-in Corp', creditTermDays: 0, priceListId: null },
      { type: 'body', metatype: CreateCustomerDto },
    );
    expect(out.name).toBe('Walk-in Corp');
    expect(out.priceListId).toBeNull();
  });

  it('create: a price list id passes', async () => {
    const out = await pipe.transform(
      { name: 'Cafe Partner', creditTermDays: 30, priceListId: 'pl_1' },
      { type: 'body', metatype: CreateCustomerDto },
    );
    expect(out.priceListId).toBe('pl_1');
  });

  it('update: the same shape passes', async () => {
    const out = await pipe.transform(
      { name: 'Cafe Partner', creditTermDays: 30, priceListId: null },
      { type: 'body', metatype: UpdateCustomerDto },
    );
    expect(out.priceListId).toBeNull();
  });

  it('still rejects fields nobody declared', async () => {
    await expect(pipe.transform(
      { name: 'X', somethingElse: 1 },
      { type: 'body', metatype: CreateCustomerDto },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CustomersService — price list handling', () => {
  function make(priceListRow: unknown = { id: 'pl_1' }) {
    const prisma = {
      priceList: { findFirst: jest.fn().mockResolvedValue(priceListRow) },
      customer:  {
        create:     jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data })),
        findFirst:  jest.fn().mockResolvedValue({ id: 'c1', tenantId: 't1', orders: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { svc: new CustomersService(prisma as never), prisma };
  }

  it('create with null saves the customer on default pricing', async () => {
    const { svc, prisma } = make();
    await svc.create('t1', { name: 'A', priceListId: null });
    expect(prisma.priceList.findFirst).not.toHaveBeenCalled();
    expect(prisma.customer.create.mock.calls[0][0].data.priceListId).toBeUndefined();
  });

  it('create with an id checks it belongs to THIS shop, then saves it', async () => {
    const { svc, prisma } = make();
    await svc.create('t1', { name: 'A', priceListId: 'pl_1' });
    expect(prisma.priceList.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pl_1', tenantId: 't1' } }),
    );
    expect(prisma.customer.create.mock.calls[0][0].data.priceListId).toBe('pl_1');
  });

  it("refuses another shop's price list in plain words", async () => {
    const { svc } = make(null);
    await expect(svc.create('t1', { name: 'A', priceListId: 'pl_other' }))
      .rejects.toThrow(/price list no longer exists/i);
  });

  it('update with null clears the special pricing', async () => {
    const { svc, prisma } = make();
    await svc.update('c1', 't1', { priceListId: null });
    expect(prisma.customer.updateMany.mock.calls[0][0].data).toEqual({ priceListId: null });
  });

  it('update without the field leaves pricing alone', async () => {
    const { svc, prisma } = make();
    await svc.update('c1', 't1', { name: 'B' });
    expect(prisma.customer.updateMany.mock.calls[0][0].data).toEqual({ name: 'B' });
  });
});
