/**
 * The Android back button. Without this the app closes on the first press, even with a dialog
 * open. `closeSomething` closes the topmost open thing and says whether there was one; with
 * nothing open, a second press within two seconds leaves the app.
 */
import { isApp } from './index';

const EXIT_WINDOW_MS = 2000;

export async function handleBackButton(closeSomething: () => boolean, warnExit: () => void): Promise<void> {
  if (!isApp()) return;
  const { onBackButtonPress, exit } = await import('@tauri-apps/api/app');
  let armed = 0;
  try {
    await onBackButtonPress(() => {
      if (closeSomething()) return;
      if (Date.now() - armed < EXIT_WINDOW_MS) void exit(0);
      else {
        armed = Date.now();
        warnExit();
      }
    });
  } catch {
    /* desktop: there is no back button */
  }
}
