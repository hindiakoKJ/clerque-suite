import { randomBytes } from 'crypto';

/**
 * The secret in a laundry ticket's public link, /stub/<token>.
 *
 * The link shows the customer's name, the shop, the amount and the status to
 * anyone who holds it, so the token alone must be unguessable. It used to be
 * the claim number plus 4 Math.random letters; the claim number is a per-shop
 * counter in the same CLA-YYYY-###### form for every shop, so the whole
 * secret was about a million guesses, and each guess tried ticket #1 of every
 * laundry shop at once.
 *
 * Now: 18 random bytes from the OS (144 bits), base64url, so it is safe in a
 * URL and a QR code as it is. It has nothing to do with the claim number,
 * which stays the human code printed on the ticket.
 */
export const PUBLIC_STUB_TOKEN_BYTES = 18;

export function newPublicStubToken(): string {
  return randomBytes(PUBLIC_STUB_TOKEN_BYTES).toString('base64url');
}
