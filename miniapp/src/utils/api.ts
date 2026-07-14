/**
 * API 客户端 v2 — 支持重试 + 超时 + 离线降级
 *
 * 改进:
 * - 请求重试（网络波动自动重试 1 次）
 * - 超时配置 15s → 30s
 * - 离线判断 + 跳过请求
 * - 统一错误处理
 * - Token 自动刷新
 */
import Taro from '@tarojs/taro';
import { clearBusinessCache } from './storage';
import { isReviewExperienceIdentity, reviewCleanupStorageKeys } from './reviewExperience';

const STORAGE_KEY_BASE_URL = 'scheduling_api_base_url';
declare const __API_BASE_URL__: string | undefined;
const DEFAULT_BASE_URL = (typeof __API_BASE_URL__ !== 'undefined' && __API_BASE_URL__)
  ? __API_BASE_URL__.replace(/\/+$/, '')
  : 'https://physicsedu.xyz/scheduling';
const RETRY_COUNT = 1;
const REQUEST_TIMEOUT = 30000;

function getBaseUrl(): string {
  try {
    return Taro.getStorageSync(STORAGE_KEY_BASE_URL) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function setBaseUrl(url: string): void {
  Taro.setStorageSync(STORAGE_KEY_BASE_URL, url.replace(/\/+$/, ''));
}

export const getApiBaseUrl = getBaseUrl;
export const setApiBaseUrl = setBaseUrl;

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  total?: number;
  code?: number | string;
}

class ApiClient {
  private tokenRefreshPromise: Promise<boolean> | null = null;

  private handleReviewAuthExpired(): void {
    const currentUser = Taro.getStorageSync('user_info');
    clearBusinessCache();
    reviewCleanupStorageKeys(currentUser).forEach(key => Taro.removeStorageSync(key));
    Taro.showToast({ title: '\u5ba1\u6838\u4f53\u9a8c\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u8fdb\u5165', icon: 'none', duration: 2000 });
    setTimeout(() => Taro.redirectTo({ url: '/pages/login/index' }), 1500);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    try {
      const token = Taro.getStorageSync('auth_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch { /* ignore */ }
    return headers;
  }

  private buildUrl(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): string {
    const url = `${getBaseUrl()}${path}`;
    if (method !== 'GET') return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_t=${Date.now()}`;
  }

  /** Token 刷新 */
  private async refreshToken(): Promise<boolean> {
    try {
      const token = Taro.getStorageSync('auth_token');
      if (!token) return false;
      const res = await Taro.request({
        url: `${getBaseUrl()}/api/auth/refresh`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        data: { token },
        timeout: 10000,
      });
      if (res.statusCode === 200 && res.data?.data?.token) {
        Taro.setStorageSync('auth_token', res.data.data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Token 过期处理 */
  private handleAuthExpired(): void {
    clearBusinessCache();
    Taro.removeStorageSync('auth_token');
    Taro.removeStorageSync('user_info');
    Taro.removeStorageSync('user_permissions');
    Taro.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 });
    setTimeout(() => Taro.redirectTo({ url: '/pages/login/index' }), 1500);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: any,
    retries = RETRY_COUNT,
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, method);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await Taro.request({
          url,
          method,
          header: this.getHeaders(),
          data: method !== 'GET' ? data : undefined,
          timeout: REQUEST_TIMEOUT,
          dataType: 'json',
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data as any;
          // 兼容 server 直接返回或 { code, data } 格式
          if (body && typeof body === 'object') {
            if ('success' in body) return body as ApiResponse<T>;
            if (body.code !== undefined) {
              return body.code === 0
                ? { success: true, data: body.data, code: body.code }
                : { success: false, error: body.message || body.error || '请求失败', code: body.code };
            }
          }
          return { success: true, data: body as T };
        } else if (res.statusCode === 401) {
          const currentUser = Taro.getStorageSync('user_info');
          if (isReviewExperienceIdentity(currentUser)) {
            this.handleReviewAuthExpired();
            return {
              success: false,
              error: '\u5ba1\u6838\u4f53\u9a8c\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u8fdb\u5165',
              code: 'REVIEW_DEMO_TOKEN_INVALID',
            };
          }
          // Token 过期，自动刷新
          if (this.tokenRefreshPromise) {
            await this.tokenRefreshPromise;
            continue; // 刷新后重试
          }
          this.tokenRefreshPromise = this.refreshToken();
          const refreshed = await this.tokenRefreshPromise;
          this.tokenRefreshPromise = null;
          if (refreshed) continue; // 刷新成功，重试
          this.handleAuthExpired();
          return { success: false, error: '登录已过期' };
        } else if (res.statusCode === 403) {
          if (res.data?.code || res.data?.error) {
            return {
              success: false,
              error: res.data?.error,
              code: res.data?.code,
            };
          }
          return { success: false, error: '无权限访问' };
        } else if (res.statusCode >= 400 && res.statusCode < 500) {
          return {
            success: false,
            error: res.data?.message || res.data?.error || `Request failed (${res.statusCode})`,
            code: res.data?.code,
          };
        } else if (res.statusCode >= 500 && res.data?.code === 'REVIEW_DEMO_DISABLED') {
          return { success: false, error: res.data?.error, code: res.data.code };
        } else if (res.statusCode >= 500 && attempt < retries) {
          continue; // 服务端错误，重试
        } else {
          return { success: false, error: `服务器错误 (${res.statusCode})` };
        }
      } catch (err: any) {
        console.error(`[API] 请求失败 ${method} ${url} (attempt ${attempt + 1}/${retries + 1}):`, err);
        const lastAttempt = attempt >= retries;
        if (err.errMsg?.includes('timeout')) {
          if (lastAttempt) return { success: false, error: '请求超时，请稍后重试' };
        } else if (err.errMsg?.includes('fail') && lastAttempt) {
          return { success: false, error: '网络连接失败，请检查网络' };
        }
        if (lastAttempt) {
          return { success: false, error: err.errMsg || '请求失败' };
        }
      }
    }

    return { success: false, error: '请求失败（多次重试后）' };
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, data?: any) { return this.request<T>('POST', path, data); }
  put<T>(path: string, data?: any) { return this.request<T>('PUT', path, data); }
  patch<T>(path: string, data?: any) { return this.request<T>('PATCH', path, data); }
  delete<T>(path: string) { return this.request<T>('DELETE', path); }
}

export const api = new ApiClient();

// ========== 认证 API ==========
export const authApi = {
  login: (data: { openid: string; name?: string }) =>
    api.post<{ token: string; user: any }>('/api/auth/login', data),
  refresh: (token: string) =>
    api.post<{ token: string }>('/api/auth/refresh', { token }),
  reviewDemo: (code: string, role: 'admin' | 'student') =>
    api.post<{ token: string; role: 'admin' | 'student'; user: any }>('/api/auth/review-demo', { code, role }),
};

// ========== 模块/权限 API ==========
export const moduleApi = {
  list: () => api.get<any[]>('/api/modules'),
  myPermissions: () => api.get<any[]>('/api/permissions/my'),
};

// ========== 管理员 API ==========
export const adminApi = {
  getPendingPairings: () => api.get<any>('/api/desktop-pairing/pending'),
  reviewPairingCode: (code: string, action: 'approve' | 'reject', userId?: string) => api.post(`/api/desktop-pairing/code/${code}/${action}`, action === 'approve' ? { userId } : {}),
  getUsers: (params?: { page?: number; search?: string; role?: string; review_status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.search) qs.set('search', params.search);
    if (params?.role) qs.set('role', params.role);
    if (params?.review_status) qs.set('status', params.review_status);
    return api.get<{ users: any[]; total: number }>(`/api/admin/users?${qs}`);
  },
  reviewUser: (userId: string, role: string) =>
    api.patch(`/api/admin/users/${userId}/review`, { role }),
  disableUser: (userId: string) => api.patch(`/api/admin/users/${userId}/disable`, {}),
};

export const cloudRelayApi = {
  readCloudSnapshot: (snapshotType = 'full') =>
    api.get<any>(`/api/cloud/snapshots/read?snapshotType=${snapshotType}`),
  createMiniappTask: (taskType: string, payload: any) =>
    api.post<any>('/api/cloud/tasks', { taskType, payload }),
  getMiniappTaskResult: (taskId: string) =>
    api.get<any>(`/api/cloud/tasks/${taskId}/result`),
  readQuestionPreview: () => api.get<any>('/api/cloud/snapshots/questions'),
  createPaperTaskV2: (taskType: string, payload: any, targetHostDeviceId: string, idempotencyKey: string) =>
    api.post<any>('/api/cloud/tasks', { protocolVersion: 2, taskType, payload, targetHostDeviceId, idempotencyKey }),
  cancelMiniappTask: (taskId: string) => api.post<any>(`/api/cloud/tasks/${taskId}/cancel`, {}),
};

export const reviewDemoApi = {
  createTask: (taskType: string, payload: any) =>
    api.post<any>('/api/review-demo/tasks', { taskType, payload }),
  getTaskResult: (taskId: string) =>
    api.get<any>(`/api/review-demo/tasks/${encodeURIComponent(taskId)}/result`),
  cancelTask: (taskId: string) =>
    api.post<any>(`/api/review-demo/tasks/${encodeURIComponent(taskId)}/cancel`, {}),
  artifactUrl: (artifactId: string) =>
    `${getBaseUrl()}/api/review-demo/artifacts/${encodeURIComponent(artifactId)}`,
  downloadArtifact: (artifactId: string) => {
    const token = Taro.getStorageSync('auth_token');
    return Taro.downloadFile({
      url: `${getBaseUrl()}/api/review-demo/artifacts/${encodeURIComponent(artifactId)}`,
      header: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};

export const readCloudSnapshot = cloudRelayApi.readCloudSnapshot;
export const createMiniappTask = cloudRelayApi.createMiniappTask;
export const getMiniappTaskResult = cloudRelayApi.getMiniappTaskResult;
export const readQuestionPreview = cloudRelayApi.readQuestionPreview;
export const createPaperTaskV2 = cloudRelayApi.createPaperTaskV2;
export const cancelMiniappTask = cloudRelayApi.cancelMiniappTask;

// ========== 业务 API ==========
export const studentApi = {
  getAll: () => api.get<any[]>('/api/students'),
  getById: (id: string) => api.get<any>(`/api/students/${id}`),
};

export const courseApi = {
  getAll: () => api.get<any[]>('/api/courses'),
  getById: (id: string) => api.get<any>(`/api/courses/${id}`),
};

export const scheduleApi = {
  getAll: () => api.get<any[]>('/api/schedules'),
  getByDateRange: (start: string, end: string) =>
    api.get<any[]>(`/api/schedules?start=${start}&end=${end}`),
  getById: (id: string) => api.get<any>(`/api/schedules/${id}`),
};

export const teacherApi = {
  getAll: () => api.get<any[]>('/api/teachers'),
  getById: (id: string) => api.get<any>(`/api/teachers/${id}`),
};

export const paymentApi = {
  getAll: () => api.get<any[]>('/api/payments'),
  getByStudent: (studentId: string) => api.get<any[]>(`/api/payments?student_id=${studentId}`),
};

export const gradeApi = {
  getByStudent: (studentId: string) => api.get<any[]>(`/api/grades?student_id=${studentId}`),
};

export const statsApi = {
  getRevenue: (start: string, end: string) =>
    api.get<any>(`/api/stats/revenue?start=${start}&end=${end}`),
};

export const syncApi = {
  pull: (lastSyncTs: number) => api.post<any>('/api/sync/pull', { lastSyncTimestamp: lastSyncTs }),
  push: (changes: any[]) => api.post<any>('/api/sync/push', { changes }),
};
