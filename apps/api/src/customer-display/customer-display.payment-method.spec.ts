import { CustomerDisplayService } from './customer-display.service';

describe('customer display relay keeps the payment method', () => {
  it('a second-device display reads the method the cashier picked', () => {
    const svc = new CustomerDisplayService();
    svc.publish('t-1', 'cashier-1', {
      type: 'PAYMENT_PENDING', lines: [], subtotal: 100, discount: 0, vatAmount: 0, total: 100,
      paymentMethod: 'GCASH',
    });
    expect(svc.readLatestForTenant('t-1')?.paymentMethod).toBe('GCASH');
  });
});
