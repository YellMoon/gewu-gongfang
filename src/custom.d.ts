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
declare module './services/pairingApiBase.mjs' {
  export const resolveOnlineSyncActor: any;
  export const resolvePairingApiBase: any;
}
declare module './services/identityDeviceCenterPolicy.mjs' {
  export const approveDesktopChallenge: any;
  export const buildApprovalBody: any;
  export const buildRejectionBody: any;
  export const buildRevocationBody: any;
  export const identityDeviceCenterAccess: any;
  export const identityDeviceCenterErrorMessage: any;
  export const loadIdentityDeviceCenter: any;
  export const loadIdentityDevicePendingCount: any;
  export const projectIdentityDeviceCenterSnapshot: any;
  export const rejectDesktopChallenge: any;
  export const revokeDesktopDevice: any;
}
declare module './services/desktopIdentityPartition.mjs' {
  export const partitionedStorageKey: any;
  export const migrateLegacyStorageValue: any;
  export const readCurrentDesktopIdentityContext: any;
  export const readCurrentDesktopIdentityPartition: any;
  export const setCurrentDesktopIdentityContext: any;
  export const setCurrentDesktopIdentityPartition: any;
  export const clearCurrentDesktopIdentityPartition: any;
}
declare module './services/desktopIdentityClient.mjs' {
  export const OFFLINE_LEASE_MAX_MS: number;
  export const canStartBusinessRuntime: any;
  export const createDesktopIdentityClient: any;
  export const isDesktopIdentityNetworkFailure: any;
  export const partitionKeyForIdentity: any;
  export const preferredActiveRole: any;
  export const registrationViewForChallenge: any;
  export const resolveDesktopGateState: any;
}
declare module './services/desktopCacheProjection.mjs' {
  export const projectDesktopCacheForIdentity: any;
}
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
    beginSingleUserEnrollment(input?: { deviceName?: string }): Promise<any>;
    createPairingEnvelope(input: {
      capability: Record<string, any>;
      pairingCode: string;
    }): Promise<Record<string, any>>;
    beginPasswordReset(): Promise<any>;
    completeRegistration(input: {
      password: string;
      authorization: Record<string, any>;
      profile: Record<string, any>;
      offlineLease?: Record<string, any> | null;
    }): Promise<any>;
    completePasswordReset(input: {
      password: string;
      authorization: Record<string, any>;
      profile: Record<string, any>;
      offlineLease?: Record<string, any> | null;
    }): Promise<any>;
    unlock(input: { password: string }): Promise<any>;
    lock(): Promise<any>;
    refreshOfflineLease(input: Record<string, any>): Promise<any>;
    signChallenge(input: Record<string, any>): Promise<any>;
  };
  singleUserRuntime?: {
    enableMode(input: { confirmation: 'ENABLE_SINGLE_USER_MODE' }): Promise<any>;
    disableMode(input: { confirmation: 'DISABLE_SINGLE_USER_MODE' }): Promise<any>;
    status(): Promise<any>;
    bootstrap(input: Record<string, any>): Promise<any>;
    resetHostPassword(input: Record<string, any>): Promise<any>;
    issuePairingCode(): Promise<any>;
    revokePairingCode(input: { grantId: string }): Promise<any>;
  };
}
