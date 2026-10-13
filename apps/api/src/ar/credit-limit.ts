import type { PrismaService } from '../prisma/prisma.service';

/**
 * What a customer owes on account right now.
 *
 * Every CHARGE sale to them that was not voided, less what has been collected
 * on it, counting only sales with something still to collect. This is the one
 * definition: the Customers list, the customer page and the credit-limit check
 * at the till all read it, so the three can never disagree about a balance.
 */
export async function openChargeBalance(
  prisma: Pick<PrismaService, 'order'>,
  tenantId: string,
  customerId: string,
): Promise<number> {
  const chargeOrders = await prisma.order.findMany({
    where: {
      tenantId,
      customerId,
      invoiceType: 'CHARGE',
      status: { not: 'VOIDED' },
    },
    include: { payments: true },
  });

  let total = 0;
  for (const order of chargeOrders) {
    const invoiceAmt = Number(order.totalAmount);
    const collected  = order.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining  = invoiceAmt - collected;
    if (remaining > 0) total += remaining;
  }

  return Math.round(total * 100) / 100;
}

const peso = (n: number) =>
  '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Why a sale on account may not go through, or null when it fits.
 *
 * No limit on the customer = no check. A sale that lands exactly on the limit
 * fits; one centavo over does not.
 */
export function overCreditLimitMessage(input: {
  name:        string;
  creditLimit: number | null;
  owes:        number;
  sale:        number;
}): string | null {
  const { name, creditLimit, owes, sale } = input;
  if (creditLimit == null) return null;
  if (owes + sale <= creditLimit + 0.005) return null;
  return (
    `This sale would put ${name} over their ${peso(creditLimit)} credit limit ` +
    `(owes ${peso(owes)} now). Take payment, or ask the owner.`
  );
}
