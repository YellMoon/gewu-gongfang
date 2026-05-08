/**
 * 插件同步服务 — 将桌面端插件清单同步到服务端注册中心
 *
 * 工作流程：
 * 1. 收集所有已注册插件的 manifest
 * 2. 推送 POST /api/teaching-tools/tools/sync
 * 3. 服务端增量更新（新增/更新/跳过）
 * 4. 小程序端通过 GET /api/teaching-tools/tools 获取列表 + 参数 schema
 */
import pluginLoader from './pluginLoader';
import type { PluginManifest } from './plugin-api';

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  total: number;
  registered: number;
  updated: number;
  skipped: number;
  details?: Array<{ action: string; id: string; version: string }>;
  error?: string;
}

/** 从存储中获取服务器地址 */
function getServerUrl(): string {
  try {
    const stored = localStorage.getItem('server_url') || 'http://localhost:3001';
    return stored;
  } catch {
    return 'http://localhost:3001';
  }
}

/**
 * 获取所有插件的 manifest 列表
 */
function collectPluginManifests(): PluginManifest[] {
  return pluginLoader.getAllManifests();
}

/**
 * 将本地插件清单同步到服务端
 * @param customServerUrl 可选，自定义服务器地址
 */
export async function syncToServer(customServerUrl?: string): Promise<SyncResult> {
  const serverUrl = customServerUrl || getServerUrl();
  const manifests = collectPluginManifests();

  if (manifests.length === 0) {
    return { success: false, total: 0, registered: 0, updated: 0, skipped: 0, error: '没有插件可同步' };
  }

  try {
    const response = await fetch(`${serverUrl}/api/teaching-tools/tools/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
      },
      body: JSON.stringify({
        tools: manifests,
        source: `desktop-${navigator.platform || 'unknown'}`,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        total: manifests.length,
        registered: 0,
        updated: 0,
        skipped: 0,
        error: `HTTP ${response.status}: ${text}`,
      };
    }

    const result = await response.json();

    if (result.code !== 0) {
      return {
        success: false,
        total: manifests.length,
        registered: 0,
        updated: 0,
        skipped: 0,
        error: result.error || '同步失败',
      };
    }

    return {
      success: true,
      total: result.data.total,
      registered: result.data.registered,
      updated: result.data.updated,
      skipped: result.data.skipped,
      details: result.data.details,
    };
  } catch (err: any) {
    return {
      success: false,
      total: manifests.length,
      registered: 0,
      updated: 0,
      skipped: 0,
      error: err.message || '网络错误',
    };
  }
}

/**
 * 从服务端获取工具列表（小程序端也可用）
 * @param serverUrl 服务器地址
 */
export async function fetchToolsFromServer(serverUrl?: string): Promise<{
  success: boolean;
  tools: any[];
  error?: string;
}> {
  const url = (serverUrl || getServerUrl());

  try {
    const response = await fetch(`${url}/api/teaching-tools/tools`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
      },
    });

    if (!response.ok) {
      return { success: false, tools: [], error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (result.code !== 0) {
      return { success: false, tools: [], error: result.error };
    }

    return { success: true, tools: result.data.tools };
  } catch (err: any) {
    return { success: false, tools: [], error: err.message };
  }
}

/**
 * 获取单个工具的参数 schema
 */
export async function fetchToolSchema(serverUrl: string, toolId: string): Promise<{
  success: boolean;
  schema?: any;
  error?: string;
}> {
  try {
    const response = await fetch(`${serverUrl}/api/teaching-tools/tools/${toolId}/schema`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (result.code !== 0) {
      return { success: false, error: result.error };
    }

    return { success: true, schema: result.data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export default {
  syncToServer,
  fetchToolsFromServer,
  fetchToolSchema,
};
