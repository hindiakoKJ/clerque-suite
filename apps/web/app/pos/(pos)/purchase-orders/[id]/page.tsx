/**
 * Purchase Orders for the shop owner.
 *
 * The screens already existed under /admin, but that layout redirects anyone
 * who is not SUPER_ADMIN — so the owner the API was written for could never
 * open them. These routes re-export the same components rather than copying
 * them: the pages never reference a tenant, because the API scopes every call
 * by the JWT, so the identical component is correct in both places.
 */
export { default } from "@/app/admin/(admin)/purchase-orders/[id]/page";
