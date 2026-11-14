/**
 * API keys. The owner's screen lives at /settings/api-keys (this /admin route
 * is SUPER_ADMIN only, so owners could never reach it); the same page is shown
 * here rather than a second copy. The API scopes every call by the JWT.
 */
export { default } from '@/app/settings/api-keys/page';
