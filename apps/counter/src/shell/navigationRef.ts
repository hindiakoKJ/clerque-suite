/**
 * Clerque Counter — global navigation ref
 *
 * Lets imperative singletons (TenderingHost, SupervisorPinHost, etc) push
 * a route without having to be wrapped in a screen's `navigation` prop.
 *
 * Attached to <NavigationContainer ref={navigationRef}> once at the root.
 * Callers can then do `navigationRef.navigate('Shift')` from any context.
 *
 * Use sparingly — most navigation should still flow through the screen
 * tree. This is the escape hatch for global modals.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

/** Best-effort nav by route name. Safe to call before the container mounts —
 *  it silently no-ops when not ready (caller can still close their modal). */
export function navigate(name: string): void {
  if (navigationRef.isReady()) {
    // The container holds the typed tree; we don't carry that type up here
    // to keep this module dependency-free. Callers pass simple route names.
    (navigationRef as unknown as { navigate: (n: string) => void }).navigate(name);
  }
}
