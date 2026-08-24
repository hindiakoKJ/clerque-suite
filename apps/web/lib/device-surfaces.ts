/**
 * Surfaces that authenticate with a paired DEVICE TOKEN, never a user JWT.
 *
 * A TV showing the customer display, or a tablet running a kitchen screen, is
 * paired once by the owner and then runs unattended for months. It holds a
 * long-lived device token in localStorage which is verified against the API on
 * every poll. It has no user session, and it must never be asked for one —
 * there is nobody standing at the customer-facing screen to type a password.
 *
 * Two places have to agree on this list, and they used to be able to drift:
 *
 *   • middleware.ts, so the edge does not bounce these routes to /login; and
 *   • lib/api.ts, whose 401 handler hard-navigates to /login. That handler is
 *     the one that actually bit: any globally-mounted component firing a
 *     request through the shared client 401s on a paired device (correctly —
 *     there is no JWT), the refresh fails, and the display lands on a login
 *     screen a customer is now looking at.
 *
 * Keep them in sync by importing from here rather than restating the paths.
 */
export const DEVICE_TOKEN_SURFACES = [
  '/pair',
  '/pos/customer-display',
  '/pos/station',
] as const;

/** True when `pathname` is served by a paired device rather than a signed-in user. */
export function isDeviceTokenSurface(pathname: string | undefined | null): boolean {
  if (!pathname) return false;
  return DEVICE_TOKEN_SURFACES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
