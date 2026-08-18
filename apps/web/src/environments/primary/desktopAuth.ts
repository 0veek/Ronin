let desktopBearerTokenPromise: Promise<string> | null = null;

export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const bridge = window.desktopBridge;
  if (!bridge) {
    return Promise.resolve(null);
  }

  // Dedup in-flight reads only. Main caches the live token and drops it when
  // the backend restarts; keeping a resolved Promise here would pin a dead
  // bearer for the rest of the renderer lifetime.
  if (desktopBearerTokenPromise) {
    return desktopBearerTokenPromise;
  }

  desktopBearerTokenPromise = bridge.getLocalEnvironmentBearerToken().finally(() => {
    desktopBearerTokenPromise = null;
  });
  return desktopBearerTokenPromise;
}

export function __resetDesktopPrimaryAuthForTests(): void {
  desktopBearerTokenPromise = null;
}
