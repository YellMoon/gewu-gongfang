import { getRuntimeConfig } from './runtimeConfigClient';

function trimTrailingSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

function hostApiUrl(hostBaseUrl: string, path: string): string {
  const base = trimTrailingSlash(hostBaseUrl || 'http://127.0.0.1:3001');
  return `${base}${path.startsWith('/api') ? path : `/api${path}`}`;
}

async function postHost(path: string, body: Record<string, any> = {}) {
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig?.cloudBaseUrl) {
    return {
      success: false,
      skipped: true,
      reason: '请先在系统设置中填写阿里云服务地址',
    };
  }

  const res = await fetch(hostApiUrl(runtimeConfig.hostBaseUrl, path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(runtimeConfig.desktopSyncToken ? { 'x-gewu-desktop-sync-token': runtimeConfig.desktopSyncToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    return {
      success: false,
      error: data?.error || `HTTP ${res.status}`,
    };
  }
  return data;
}

export async function publishCloudHeartbeat() {
  return postHost('/api/cloud-relay-host/heartbeat');
}

export async function publishCloudSnapshot() {
  return postHost('/api/cloud-relay-host/snapshot');
}

export async function processMiniappCloudTasks(body: Record<string, any> = {}) {
  return postHost('/api/cloud-relay-host/tasks/process', body);
}

export default {
  publishCloudHeartbeat,
  publishCloudSnapshot,
  processMiniappCloudTasks,
};
