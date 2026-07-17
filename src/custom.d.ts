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
  export const hydrateDesktopAuthorizationSession: any;
}
declare module './services/pairingApiBase.mjs' { export const resolvePairingApiBase: any; }
declare module './services/managedSyncConfig.mjs' {
  export const DEFAULT_MANAGED_CLOUD_BASE_URL: string;
  export const resolveManagedSyncConfig: any;
  export const syncFailureMessage: any;
}
declare module './services/systemSettingsRolePolicy.mjs' { export const systemSettingsRolePolicy: any; }

interface Window {
  api?: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on?(channel: string, listener: (...args: any[]) => void): () => void;
  };
  desktopIdentity?: {
    status(): Promise<any>;
    beginRegistration(input?: { deviceName?: string }): Promise<any>;
    completeRegistration(input: {
      password: string;
      authorization: Record<string, any>;
      profile: Record<string, any>;
      offlineLease?: Record<string, any> | null;
    }): Promise<any>;
    unlock(input: { password: string }): Promise<any>;
    lock(): Promise<any>;
    signChallenge(input: Record<string, any>): Promise<any>;
  };
}
