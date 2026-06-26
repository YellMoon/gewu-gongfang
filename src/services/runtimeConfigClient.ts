export type NodeRole = 'primary-host' | 'desktop-client';

export type RuntimeConfig = {
  nodeRole: NodeRole;
  deviceId: string;
  hostBaseUrl: string;
  cloudBaseUrl: string;
  mainDbPath: string;
  questionBankPath: string;
  questionAssetPath: string;
  questionBankCandidatePaths: string[];
  questionBankStoreId: string;
  localCachePath: string;
  nasBackupPath: string;
};

function requireApi() {
  const api = (window as any).api;
  if (!api?.invoke) throw new Error('Electron API is not available');
  return api;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return requireApi().invoke('runtime-config:get');
}

export async function saveRuntimeConfig(config: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
  return requireApi().invoke('runtime-config:set', config);
}

export async function selectFolder(): Promise<string> {
  return requireApi().invoke('dialog:select-folder');
}
