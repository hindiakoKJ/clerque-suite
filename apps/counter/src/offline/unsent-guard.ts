/**
 * Clerque Counter — keep unsent sales on the device.
 *
 * The outbox holds sales (and drawer closes) rung while the device was
 * offline. They exist nowhere else, so signing out must never delete them.
 * Before the device signs out or changes mode, this asks the outbox: if
 * anything is still waiting, it says so and the sign-out does not happen.
 */

import { Alert } from 'react-native';
import { countOutbox } from './db';

/** True when nothing is waiting to be sent. Otherwise tells the cashier and returns false. */
export async function nothingUnsent(): Promise<boolean> {
  let waiting = 0;
  try {
    waiting = await countOutbox();
  } catch {
    // The store could not be read: do not risk losing sales.
    Alert.alert('Not signed out', 'Clerque could not check for unsent sales. Try again.');
    return false;
  }
  if (waiting === 0) return true;
  Alert.alert(
    'Sales not sent yet',
    `${waiting} ${waiting === 1 ? 'item is' : 'items are'} still waiting to be sent to Clerque. ` +
      'Connect to the internet and open Pending Sync to send them, then sign out.',
  );
  return false;
}
