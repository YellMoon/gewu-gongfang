function createNavigationOverlayRuntime() {
  const owners = new Set();
  const listeners = new Set();
  const isBlocked = () => owners.size > 0;
  const notify = () => listeners.forEach(listener => listener(isBlocked()));
  return {
    isBlocked,
    subscribe(listener) {
      listeners.add(listener);
      listener(isBlocked());
      return () => { listeners.delete(listener); };
    },
    acquire() {
      const owner = {};
      const wasBlocked = isBlocked();
      owners.add(owner);
      if (!wasBlocked) notify();
      return () => {
        if (owners.delete(owner) && !isBlocked()) notify();
      };
    },
  };
}

const navigationOverlayRuntime = createNavigationOverlayRuntime();
module.exports = { createNavigationOverlayRuntime, navigationOverlayRuntime };
