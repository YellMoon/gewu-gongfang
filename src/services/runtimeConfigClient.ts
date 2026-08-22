export type RuntimeConfig = {
  buildFlavor: string;
  nodeRole?: string;
  desktopIdentityMode: 'full';
  deviceId: string;
  cloudBaseUrl: string;
  cloudBusinessIdentityBaseUrl?: string;
};

function requireApi() {
  const api = (window as any).api;
  if (!api?.invoke) throw new Error('Electron API is not available');
  return api;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return requireApi().invoke('runtime-config:get');
}
