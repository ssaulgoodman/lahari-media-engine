/**
 * Browser notifications for bulk completion events. Fires regardless of
 * tab focus — the entire point of these is to alert the artist who is
 * actively working on a specific shot while a bulk job runs on dozens
 * of others.
 *
 * Permission is requested on first call, not at app boot (that triggers
 * a hostile permission prompt before the user has any context for why
 * the app wants it). Browser persists the grant; subsequent calls just
 * fire. If the user denies, every call becomes a silent no-op.
 *
 * No Service Worker — these only fire while the Lahari tab is alive.
 * That's fine for our case: artists keep the tab open, they're just
 * looking at a different shot inside the app when the bulk finishes.
 */

let permissionRequested = false;

export const notifyBulkComplete = async (title: string, body: string): Promise<void> => {
  // SSR / non-browser guard. Also covers older browsers without the API.
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;

  // If we don't have permission and the user hasn't already declined,
  // ask once. Awaited so the notification fires in the same tick when
  // granted — otherwise the user clicks Allow and gets no first ping.
  if (Notification.permission === 'default' && !permissionRequested) {
    permissionRequested = true;
    try {
      await Notification.requestPermission();
    } catch {
      // Older browsers may throw on the promise form. Silent.
    }
  }

  if (Notification.permission !== 'granted') return;

  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      // Tag means duplicate notifications collapse rather than stack —
      // if the artist fires two bulks back-to-back the second replaces
      // the first instead of piling up.
      tag: 'lahari-bulk',
    });
    // Click → focus the Lahari tab (presumably the artist's already in
    // the right project, so no nav).
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers (mobile Safari, locked-down profiles) throw on
    // construction even after permission. Silent — no fallback needed.
  }
};
