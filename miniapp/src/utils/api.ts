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

const STORAGE_KEY_BASE_URL = 'scheduling_api_base_url';
const DEFAULT_BASE_URL = 'http://39.106.172.132';
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
  code?: number;
}

/** 检查是否在线 */
async function checkOnline(): Promise<boolean> {
  try {
    const res = await Taro.getNetworkType();
    return res.networkType !== 'none';
  } catch {
    return true; // 无法判断时默认在线
  }
}

class ApiClient {
  private tokenRefreshPromise: Promise<boolean> | null = null;

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    try {
      const token = Taro.getStorageSync('auth_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch { /* ignore */ }
    return headers;
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
    Taro.removeStorageSync('auth_token');
    Taro.removeStorageSync('user_info');
    Taro.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 });
    setTimeout(() => Taro.redirectTo({ url: '/pages/login/index' }), 1500);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: any,
    retries = RETRY_COUNT,
  ): Promise<ApiResponse<T>> {
    const baseUrl = getBaseUrl();

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // 离线跳过多余尝试
        if (attempt > 0) {
          const online = await checkOnline();
          if (!online) {
            return { success: false, error: '当前无网络连接' };
          }
        }

        const res = await Taro.request({
          url: `${baseUrl}${path}`,
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
          return { success: false, error: '无权限访问' };
        } else if (res.statusCode >= 500 && attempt < retries) {
          continue; // 服务端错误，重试
        } else {
          return { success: false, error: `服务器错误 (${res.statusCode})` };
        }
      } catch (err: any) {
        console.error(`[API] 请求失败 (attempt ${attempt + 1}/${retries + 1}):`, err);
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
  delete<T>(path: string) { return this.request<T>('DELETE', path); }
}

export const api = new ApiClient();

// ========== 认证 API ==========
export const authApi = {
  login: (data: { openid: string; name?: string }) =>
    api.post<{ token: string; user: any }>('/api/auth/login', data),
  register: (data: { openid: string; invite_code: string; name?: string }) =>
    api.post<{ token: string; user: any }>('/api/auth/register', data),
  refresh: (token: string) =>
    api.post<{ token: string }>('/api/auth/refresh', { token }),
};

// ========== 模块/权限 API ==========
export const moduleApi = {
  list: () => api.get<any[]>('/api/modules'),
  myPermissions: () => api.get<any[]>('/api/permissions/my'),
};

// ========== 管理员 API ==========
export const adminApi = {
  getUsers: (params?: { page?: number; search?: string; user_type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.search) qs.set('search', params.search);
    if (params?.user_type) qs.set('user_type', params.user_type);
    return api.get<{ users: any[]; total: number }>(`/api/admin/users?${qs}`);
  },
  setUserType: (userId: string, userType: string) =>
    api.put(`/api/admin/users/${userId}/type`, { user_type: userType }),
  getUserPermissions: (userId: string) =>
    api.get<any[]>(`/api/admin/users/${userId}/permissions`),
  grantPermission: (userId: string, permissionId: string, expiresAt?: string) =>
    api.post(`/api/admin/users/${userId}/permissions`, { permission_id: permissionId, expires_at: expiresAt }),
  revokePermission: (userId: string, permissionId: string) =>
    api.delete(`/api/admin/users/${userId}/permissions/${permissionId}`),
};

// ========== 邀请码 API ==========
export const invitationApi = {
  create: (data: { target_name?: string; permissions?: string[] }) =>
    api.post<any>('/api/invitations/create', data),
  list: () => api.get<any[]>('/api/invitations/list'),
  revoke: (id: string) => api.delete(`/api/invitations/${id}`),
};

export const cloudRelayApi = {
  readCloudSnapshot: (snapshotType = 'full') =>
    api.get<any>(`/api/cloud/snapshots/read?snapshotType=${snapshotType}`),
  createMiniappTask: (taskType: string, payload: any) =>
    api.post<any>('/api/cloud/tasks', { taskType, payload }),
  getMiniappTaskResult: (taskId: string) =>
    api.get<any>(`/api/cloud/tasks/${taskId}/result`),
};

export const readCloudSnapshot = cloudRelayApi.readCloudSnapshot;
export const createMiniappTask = cloudRelayApi.createMiniappTask;

// ========== 业务 API ==========
export const studentApi = {
  getAll: () => api.get<any[]>('/scheduling/students'),
  getById: (id: string) => api.get<any>(`/scheduling/students/${id}`),
  create: (data: any) => api.post<any>('/scheduling/students', data),
  update: (id: string, data: any) => api.put<any>(`/scheduling/students/${id}`, data),
  delete: (id: string) => api.delete(`/scheduling/students/${id}`),
};

export const courseApi = {
  getAll: () => api.get<any[]>('/scheduling/courses'),
  getById: (id: string) => api.get<any>(`/scheduling/courses/${id}`),
  create: (data: any) => api.post<any>('/scheduling/courses', data),
  update: (id: string, data: any) => api.put<any>(`/scheduling/courses/${id}`, data),
  delete: (id: string) => api.delete(`/scheduling/courses/${id}`),
};

export const scheduleApi = {
  getAll: () => api.get<any[]>('/scheduling/schedules'),
  getByDateRange: (start: string, end: string) =>
    api.get<any[]>(`/scheduling/schedules?start=${start}&end=${end}`),
  getById: (id: string) => api.get<any>(`/scheduling/schedules/${id}`),
  create: (data: any) => api.post<any>('/scheduling/schedules', data),
  update: (id: string, data: any) => api.put<any>(`/scheduling/schedules/${id}`, data),
  delete: (id: string) => api.delete(`/scheduling/schedules/${id}`),
};

export const teacherApi = {
  getAll: () => api.get<any[]>('/scheduling/teachers'),
  getById: (id: string) => api.get<any>(`/scheduling/teachers/${id}`),
  create: (data: any) => api.post<any>('/scheduling/teachers', data),
  update: (id: string, data: any) => api.put<any>(`/scheduling/teachers/${id}`, data),
  delete: (id: string) => api.delete(`/scheduling/teachers/${id}`),
};

export const paymentApi = {
  getAll: () => api.get<any[]>('/scheduling/payments'),
  getByStudent: (studentId: string) => api.get<any[]>(`/scheduling/payments?student_id=${studentId}`),
  create: (data: any) => api.post<any>('/scheduling/payments', data),
};

export const gradeApi = {
  getByStudent: (studentId: string) => api.get<any[]>(`/scheduling/grades?student_id=${studentId}`),
  create: (data: any) => api.post<any>('/scheduling/grades', data),
};

export const statsApi = {
  getRevenue: (start: string, end: string) =>
    api.get<any>(`/scheduling/stats/revenue?start=${start}&end=${end}`),
};

export const syncApi = {
  pull: (lastSyncTs: number) => api.post<any>('/scheduling/sync/pull', { lastSyncTimestamp: lastSyncTs }),
  push: (changes: any[]) => api.post<any>('/scheduling/sync/push', { changes }),
};
