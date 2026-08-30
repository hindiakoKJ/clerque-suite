/**
 * Stock on hand, now living in Procure.
 *
 * Everything that ADDS inventory belongs here rather than in the POS: a till
 * exists to take money, and mixing "receive a delivery" into it is what makes
 * a cashier account also an inventory account. Keeping them apart is what lets
 * a dedicated inventory role exist later without breaking separation of
 * duties.
 *
 * Re-exported rather than copied. The component never references a tenant or a
 * route — the API scopes every call by the JWT — so the same screen is correct
 * in both places, and there is only ever one of it to fix.
 */
export { default } from '@/app/pos/(pos)/inventory/page';
