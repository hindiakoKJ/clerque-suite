/**
 * The Record Entry form's payload must pass the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) — an undeclared field is a 400.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateSimpleEntryDto, SIMPLE_ENTRY_TYPES, PAID_FROM } from './simple-entry.dto';

// Same options as apps/api/src/main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const check = (body: unknown) => pipe.transform(body, { type: 'body', metatype: CreateSimpleEntryDto });

describe('CreateSimpleEntryDto', () => {
  it('knows the two new kinds and the three paid-from choices', () => {
    expect(SIMPLE_ENTRY_TYPES).toContain('EQUIPMENT_PURCHASE');
    expect(SIMPLE_ENTRY_TYPES).toContain('WAGES_PAID');
    expect([...PAID_FROM]).toEqual(['CASH', 'BANK', 'OWNER']);
  });

  it('accepts an equipment purchase exactly as the form sends it', async () => {
    const out = await check({
      type: 'EQUIPMENT_PURCHASE', amount: 85000, date: '2026-09-22',
      paidFrom: 'OWNER', note: 'second-hand', assetName: 'Espresso machine',
    });
    expect(out.paidFrom).toBe('OWNER');
    expect(out.assetName).toBe('Espresso machine');
  });

  it('accepts wages paid', async () => {
    const out = await check({ type: 'WAGES_PAID', amount: 3500, date: '2026-09-22', paidFrom: 'CASH', note: 'Ana' });
    expect(out.type).toBe('WAGES_PAID');
  });

  it('refuses a paid-from it does not know', async () => {
    await expect(check({ type: 'WAGES_PAID', amount: 1, date: '2026-09-22', paidFrom: 'GCASH' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a zero amount and an unknown kind', async () => {
    await expect(check({ type: 'WAGES_PAID', amount: 0, date: '2026-09-22' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(check({ type: 'BONUS', amount: 10, date: '2026-09-22' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
