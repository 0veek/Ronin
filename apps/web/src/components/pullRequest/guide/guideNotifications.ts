const notifications = new Set<Notification>();
export function clearGuideNotifications() {
  for (const notification of notifications) notification.close();
  notifications.clear();
}
export function notifyGuide(title: string, body: string, runKey: string, open: () => void) {
  try {
    const notification = new Notification(title, { body, tag: `guide:${runKey}`, silent: true });
    notifications.add(notification);
    notification.onclose = () => {
      notifications.delete(notification);
      notification.onclick = null;
      notification.onclose = null;
    };
    notification.onclick = () => {
      notification.close();
      window.focus();
      void window.desktopBridge?.focusWindow?.();
      open();
    };
  } catch {
    /* Some clients reject system presentation. */
  }
}
