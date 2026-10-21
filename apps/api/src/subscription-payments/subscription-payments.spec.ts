import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  SubscriptionPaymentsService, publicPaymentView, randomReferenceSuffix,
} from './subscription-payments.service';
import { SubscriptionPaymentsController } from './subscription-payments.controller';

/**
 * The public /pay/<code> page (AUTH-3 / BOOKS-1).
 *
 * The reference code is the only key to it. It was 5 Math.random letters, so
 * a script could find other shops' payments, read them, and overwrite their
 * proof of payment. Pinned here: the code is long and random, the page shows
 * the shop's name only while the payer needs it, and proof is accepted once.
 */
describe('Subscription payments — the public page', () => {
  const LETTER = '[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]';
  const SUFFIX = new RegExp(`^${LETTER}{4}-${LETTER}{4}-${LETTER}{4}-${LETTER}{4}$`);

  const PAYMENT = {
    id: 'pp-1', tenantId: 't-1', referenceCode: 'RENEW-7Z2K-M4PQ-X9TB-3HNC',
    planCode: 'CLERQUE', amountPhpCents: 19900,
    periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-11-01'),
    reason: 'MONTHLY_RENEWAL', status: 'AWAITING_PROOF', submittedAt: null,
    expiresAt: new Date('2026-11-01'), tenant: { name: 'Kape Tayo', slug: 'kape-tayo' },
  };

  function build(row: any = PAYMENT, taken: string[] = []) {
    const prisma: any = {
      pendingPayment: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.referenceCode) {
            if (taken.includes(where.referenceCode)) return { id: 'other' };
            return row && where.referenceCode === row.referenceCode ? { ...row } : null;
          }
          return null;
        }),
        updateMany: jest.fn(async ({ where }: any) => ({
          count: row && where.id === row.id && where.status === row.status ? 1 : 0,
        })),
        update: jest.fn(),
      },
    };
    const svc = new SubscriptionPaymentsService(prisma, {} as any);
    return { svc, prisma };
  }

  describe('reference code', () => {
    it('is 16 letters in groups of four, from the 32-letter alphabet (80 bits)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 2000; i++) {
        const s = randomReferenceSuffix();
        expect(s).toMatch(SUFFIX);
        seen.add(s);
      }
      // 2000 draws from 2^80 never repeat; the old 5 letters made that plausible.
      expect(seen.size).toBe(2000);
    });

    it('is drawn from the OS random source, not Math.random', () => {
      const spy = jest.spyOn(Math, 'random');
      randomReferenceSuffix();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('keeps the readable prefix the payer types into transfer remarks', async () => {
      const { svc } = build(null);
      const code: string = await (svc as any).generateUniqueReferenceCode('MONTHLY_RENEWAL');
      expect(code).toMatch(new RegExp(`^RENEW-${SUFFIX.source.slice(1)}`));
      expect(await (svc as any).generateUniqueReferenceCode('NEW_SIGNUP')).toMatch(/^SIGNUP-/);
      expect(await (svc as any).generateUniqueReferenceCode('PLAN_UPGRADE')).toMatch(/^UPGRADE-/);
    });
  });

  describe('what the page is shown', () => {
    it('names the shop while the payment is open, which is when the page greets the payer', () => {
      expect(publicPaymentView({ ...PAYMENT, status: 'AWAITING_PROOF' })).toMatchObject({ tenantName: 'Kape Tayo' });
      expect(publicPaymentView({ ...PAYMENT, status: 'PROOF_SUBMITTED' })).toMatchObject({ tenantName: 'Kape Tayo' });
    });

    it.each(['CONFIRMED', 'REJECTED', 'EXPIRED'])('does not name the shop once the payment is %s', (status) => {
      const view = publicPaymentView({ ...PAYMENT, status });
      expect(view).not.toHaveProperty('tenantName');
      expect(view).toMatchObject({ status, amountPhpCents: 19900, planCode: 'CLERQUE' });
    });

    it('never sends the shop id, slug or any submitted proof', () => {
      const view = publicPaymentView({ ...PAYMENT, submittedRefId: 'X', submittedProofUrl: 'https://x' } as any);
      expect(Object.keys(view).sort()).toEqual([
        'amountPhpCents', 'expiresAt', 'periodEnd', 'periodStart', 'planCode',
        'reason', 'referenceCode', 'status', 'submittedAt', 'tenantName',
      ]);
    });
  });

  describe('submit proof — once', () => {
    const PROOF = {
      referenceCode: PAYMENT.referenceCode, submittedRefId: 'MAYA-123456',
      submittedMethod: 'MAYA' as const, submittedProofUrl: 'https://drive.example/receipt.png',
    };

    it('the first proof on an open payment is recorded, only while it is still awaiting proof', async () => {
      const { svc, prisma } = build();
      const res = await svc.submitProof(PROOF);
      expect(res.status).toBe('PROOF_SUBMITTED');
      const call = prisma.pendingPayment.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'pp-1', status: 'AWAITING_PROOF' });
      expect(call.data).toMatchObject({
        status: 'PROOF_SUBMITTED', submittedRefId: 'MAYA-123456', submittedMethod: 'MAYA',
        submittedProofUrl: 'https://drive.example/receipt.png',
      });
    });

    it('a second proof is refused and the first one stands', async () => {
      const { svc, prisma } = build({ ...PAYMENT, status: 'PROOF_SUBMITTED' });
      await expect(svc.submitProof({ ...PROOF, submittedRefId: 'FAKE-999' }))
        .rejects.toThrow(new ConflictException(
          'Proof for this payment was already sent and is waiting for review. If it needs correcting, contact support.',
        ));
      expect(prisma.pendingPayment.updateMany).not.toHaveBeenCalled();
      expect(prisma.pendingPayment.update).not.toHaveBeenCalled();
    });

    it('two proofs sent at the same moment: the one that loses the race is refused', async () => {
      const { svc, prisma } = build();
      prisma.pendingPayment.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(svc.submitProof(PROOF)).rejects.toThrow(ConflictException);
    });

    it('a confirmed payment still refuses proof, as before', async () => {
      const { svc } = build({ ...PAYMENT, status: 'CONFIRMED' });
      await expect(svc.submitProof(PROOF)).rejects.toThrow('This payment has already been confirmed.');
    });
  });

  describe('submit proof — the screenshot link', () => {
    function ctrl() {
      const svc = { submitProof: jest.fn(async () => ({ status: 'PROOF_SUBMITTED' })) };
      return { c: new SubscriptionPaymentsController(svc as any), svc };
    }
    const body = { submittedRefId: 'MAYA-123456', submittedMethod: 'MAYA' as const };

    it.each(['javascript:alert(document.cookie)', 'data:text/html,<script>1</script>', 'not a link'])(
      'refuses %s, which the Console would show the platform admin as a link',
      async (url) => {
        const { c, svc } = ctrl();
        await expect(c.submitProof('RENEW-X', { ...body, submittedProofUrl: url })).rejects.toThrow(BadRequestException);
        expect(svc.submitProof).not.toHaveBeenCalled();
      },
    );

    it('takes an https link, or no link at all', async () => {
      const { c, svc } = ctrl();
      await expect(c.submitProof('RENEW-X', { ...body, submittedProofUrl: 'https://drive.google.com/file/d/abc' }))
        .resolves.toMatchObject({ ok: true, status: 'PROOF_SUBMITTED' });
      await expect(c.submitProof('RENEW-X', { ...body })).resolves.toMatchObject({ ok: true });
      expect(svc.submitProof).toHaveBeenCalledTimes(2);
    });
  });
});
