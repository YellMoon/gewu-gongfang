declare module '*.json' {
  const value: any;
  export default value;
}

declare module './services/oneClickSyncService.mjs' {
  export const buildOneClickSyncPreview: any;
  export const chooseSyncTransport: any;
  export const runOneClickSync: any;
}

declare module './services/oneClickSyncTransports.mjs' {
  export const createCloudRelaySyncTransport: any;
  export const createDirectSyncTransport: any;
  export const discoverLanDirectSyncTransports: any;
  export const normalizeApiBaseUrl: any;
}
declare module './services/desktopAuthorizationSession.mjs' {
  export const readDesktopAuthorizationSession: any;
}

interface Window {
  api?: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on?(channel: string, listener: (...args: any[]) => void): () => void;
  };
}
