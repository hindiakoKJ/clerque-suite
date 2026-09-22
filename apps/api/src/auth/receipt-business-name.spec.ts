import { receiptBusinessName } from './receipt-business-name';

/**
 * The name the login token carries for the top of every receipt.
 *
 * Cafe Carolina never opened Settings > BIR & Tax, so Tenant.businessName was
 * null and every customer slip was headed with the receipt's last-resort text.
 * The token now falls back to the name the business was created with.
 */
describe('receiptBusinessName — the receipt header in the login token', () => {
  it('uses the BIR "business name as on COR" when the owner filled it in', () => {
    expect(receiptBusinessName({ businessName: 'Carolina Food Ventures', name: 'Cafe Carolina' }))
      .toBe('Carolina Food Ventures');
  });

  it('falls back to the name the business was created with when the BIR field is blank', () => {
    expect(receiptBusinessName({ businessName: null, name: 'Cafe Carolina' })).toBe('Cafe Carolina');
    expect(receiptBusinessName({ name: 'Cafe Carolina' })).toBe('Cafe Carolina');
  });

  it('treats a whitespace-only BIR field as blank, and trims what it returns', () => {
    expect(receiptBusinessName({ businessName: '   ', name: ' Cafe Carolina ' })).toBe('Cafe Carolina');
    expect(receiptBusinessName({ businessName: '  Carolina Food Ventures ', name: 'Cafe Carolina' }))
      .toBe('Carolina Food Ventures');
  });

  it('is null only when there is no tenant at all (a super admin token)', () => {
    expect(receiptBusinessName(null)).toBeNull();
    expect(receiptBusinessName(undefined)).toBeNull();
    expect(receiptBusinessName({ businessName: null, name: null })).toBeNull();
    expect(receiptBusinessName({ businessName: '', name: '  ' })).toBeNull();
  });
});
