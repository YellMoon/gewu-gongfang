declare module '*.json' {
  const value: any;
  export default value;
}

declare module './services/desktopAuthorizationSession.mjs' {
  export const readDesktopAuthorizationSession: any;
  export const hydrateDesktopAuthorizationSession: any;
}
declare module './services/pairingApiBase.mjs' {
  export const resolveOnlineSyncActor: any;
  export const resolveRenewableOnlineSyncActor: any;
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
    beginUnifiedOnlineRegistration(input?: { deviceName?: string }): Promise<any>;
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
  desktopIdentitySessionProvider?: {
    listCloudBusinessProjection(): Promise<{
      students: any[];
      teachers: any[];
      courses: any[];
      schedules: any[];
      institutions: any[];
      schools: any[];
      rooms: any[];
    }>;
  };
  desktopAuthority?: {
    appendDraft(input: {
      type: string;
      payload: Record<string, unknown>;
      preview?: Record<string, unknown>;
    }): Promise<any>;
    appendDraftSync(input: {
      type: string;
      payload: Record<string, unknown>;
      preview?: Record<string, unknown>;
    }): any;
    appendDraftBatchSync(inputs: Array<{
      type: string;
      payload: Record<string, unknown>;
      preview?: Record<string, unknown>;
    }>): any[];
    list(): Promise<Array<{
      id: string;
      type: string;
      status: 'awaiting_confirmation' | 'confirmed' | 'submitted' | 'completed' | 'conflict';
      updatedAt?: string;
      preview?: Record<string, unknown>;
      submission?: { transportUsed?: string } | null;
      receipt?: { projectionVersion?: number } | null;
      conflict?: { code?: string } | null;
      [key: string]: any;
    }>>;
    readProjection(input?: { minSourceVersion?: number }): Promise<{
      protocol: 'gewu.authority-projection.v1';
      authorityId: string;
      hostEpochId: string;
      userId: string;
      role: string;
      sourceVersion: number;
      payload: Record<string, any>;
      payloadHash: string;
      signature: string;
    }>;
    submit(id: string, input?: { sessionToken: string }): Promise<any>;
    confirmAndSubmit(id: string, input?: { sessionToken: string }): Promise<any>;
  };
  primaryHostRuntime?: {
    restart(): Promise<any>;
    runtimeStatus(): Promise<any>;
    relaunchReadiness(): Promise<any>;
    executeLocalDraft(draft: { type: string; payload: Record<string, any> }): Promise<any>;
  };
}
