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
import { authSessionRuntime } from './authSession';
import { createAuthRefreshRuntime, extractRefreshToken } from './miniappAuthRefreshRuntime';
import { clearAuthenticatedSession, createApiResponseCoordinator, createSessionBoundOperation } from './miniappApiSessionRuntime';
import { selectApiBaseUrl } from './miniappApiRoutingRuntime';
import {
  accountExperienceArtifactRequest,
  accountExperiencePath,
} from './accountExperience';

const STORAGE_KEY_BASE_URL = 'scheduling_api_base_url';
declare const __API_BASE_URL__: string | undefined;
declare const __CLOUD_BUSINESS_API_BASE_URL__: string | undefined;
const DEFAULT_BASE_URL = (typeof __API_BASE_URL__ !== 'undefined' && __API_BASE_URL__)
  ? __API_BASE_URL__.replace(/\/+$/, '')
  : 'https://physicsedu.xyz/scheduling';
const DEFAULT_CLOUD_BUSINESS_BASE_URL = (typeof __CLOUD_BUSINESS_API_BASE_URL__ !== 'undefined' && __CLOUD_BUSINESS_API_BASE_URL__)
  ? __CLOUD_BUSINESS_API_BASE_URL__.replace(/\/+$/, '')
  : 'https://physicsedu.xyz/cloud-business';
const RETRY_COUNT = 1;
const REQUEST_TIMEOUT = 30000;
const AUTHENTICATION_ENTRY_PATHS = new Set(['/api/auth/login', '/api/auth/wechat-login', '/api/miniapp/cloud-login']);
const DESKTOP_AUTHORIZATION_ENTRY_PATH = /^\/api\/desktop-identity\/challenges\/[A-Za-z0-9_-]{16,128}\/(?:public|confirm)$/;

function isDesktopAuthorizationEntryPath(path: string): boolean {
  return DESKTOP_AUTHORIZATION_ENTRY_PATH.test(path);
}

export function isAuthenticationEntryPath(path: string): boolean {
  return AUTHENTICATION_ENTRY_PATHS.has(path) || isDesktopAuthorizationEntryPath(path);
}

function getBaseUrl(): string {
  try {
    return Taro.getStorageSync(STORAGE_KEY_BASE_URL) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function getRequestBaseUrl(path: string): string {
  return selectApiBaseUrl({
    normalBaseUrl: getBaseUrl(),
  });
}

export function setBaseUrl(url: string): void {
  Taro.setStorageSync(STORAGE_KEY_BASE_URL, url.replace(/\/+$/, ''));
}

export const getApiBaseUrl = getBaseUrl;
export const setApiBaseUrl = setBaseUrl;
export const getCloudBusinessApiBaseUrl = () => DEFAULT_CLOUD_BUSINESS_BASE_URL;

function cloudBusinessUrl(path: string): string {
  return `${getCloudBusinessApiBaseUrl()}${path}`;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  total?: number;
  code?: number | string;
}

class ApiClient {
  private authRefreshRuntime = createAuthRefreshRuntime({
    sessionRuntime: authSessionRuntime,
    writeToken: (token: string) => Taro.setStorageSync('auth_token', token),
    requestRefresh: (token: string) => this.requestRefreshedToken(token),
  });

  private getHeaders(token = '', extraHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      ...extraHeaders,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  private buildUrl(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): string {
    const url = `${getRequestBaseUrl(path)}${path}`;
    if (method !== 'GET') return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_t=${Date.now()}`;
  }

  /** Token 刷新 */
  private async requestRefreshedToken(token: string): Promise<string> {
    const path = '/api/auth/refresh';
    const res = await Taro.request({
      url: `${getRequestBaseUrl(path)}${path}`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      data: { token },
      timeout: 10000,
    });
    return res.statusCode === 200 ? extractRefreshToken(res.data) : '';
  }

  /** Token 过期处理 */
  private handleAuthExpired(): void {
    clearAuthenticatedSession({
      invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
      clearBusinessCache,
      clearPermissionCache: () => Taro.removeStorageSync('user_permissions'),
      removeStorage: (key: string) => Taro.removeStorageSync(key),
    });
    Taro.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 });
    setTimeout(() => Taro.redirectTo({ url: '/pages/login/index' }), 1500);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: any,
    retries = RETRY_COUNT,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, method);
    const authenticationEntry = isAuthenticationEntryPath(path);
    const anonymousEntry = isDesktopAuthorizationEntryPath(path);
    const sessionOptions = authenticationEntry ? { allowInvalidated: true } : undefined;
    const requestBinding = authSessionRuntime.capture();
    const responseCoordinator = createApiResponseCoordinator({
      sessionRuntime: authSessionRuntime,
      allowInvalidatedSession: authenticationEntry,
      authenticationEntry,
      refresh: () => this.authRefreshRuntime.refresh(),
    });
    const isCurrentSession = (session = requestBinding) => authSessionRuntime.isSameSession(session, sessionOptions);

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!isCurrentSession()) {
        return { success: false, error: '\u767b\u5f55\u72b6\u6001\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u8bd5' };
      }
      try {
        const requestSession = authSessionRuntime.capture();
        if (!isCurrentSession(requestSession)) {
          return { success: false, error: '\u767b\u5f55\u72b6\u6001\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u8bd5' };
        }
        const res = await Taro.request({
          url,
          method,
          header: this.getHeaders(anonymousEntry ? '' : requestSession.token, extraHeaders),
          data: method !== 'GET' ? data : undefined,
          timeout: REQUEST_TIMEOUT,
          dataType: 'json',
        });

        const responseDecision = await responseCoordinator.handleResponse(requestSession, res.statusCode);
        if (responseDecision.action === 'session-changed') {
          return { success: false, error: '\u767b\u5f55\u72b6\u6001\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u8bd5' };
        }
        if (responseDecision.action === 'retry') continue;
        if (responseDecision.action === 'auth-expired') {
          if (!isCurrentSession()) {
            return { success: false, error: '\u767b\u5f55\u72b6\u6001\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u8bd5' };
          }
          this.handleAuthExpired();
          return { success: false, error: '\u767b\u5f55\u5df2\u8fc7\u671f' };
        }
        if (!isCurrentSession()) {
          return { success: false, error: '\u767b\u5f55\u72b6\u6001\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u8bd5' };
        }

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
  postWithHeaders<T>(path: string, data: any, headers: Record<string, string>) {
    return this.request<T>('POST', path, data, RETRY_COUNT, headers);
  }
  put<T>(path: string, data?: any) { return this.request<T>('PUT', path, data); }
  patch<T>(path: string, data?: any) { return this.request<T>('PATCH', path, data); }
  delete<T>(path: string) { return this.request<T>('DELETE', path); }
}

export const api = new ApiClient();

export const miniappCloudAuthApi = {
  async login(loginCode: string, phoneCode: string | null): Promise<ApiResponse<{ ok: true; token: string; identity: any }>> {
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/miniapp/cloud-login'),
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        data: { loginCode, phoneCode },
        timeout: REQUEST_TIMEOUT,
        dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true) {
        return { success: true, data: response.data as { ok: true; token: string; identity: any } };
      }
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud login failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud login unavailable' };
    }
  },
};

export const miniappCloudBusinessApi = {
  async listSchedules(token: string): Promise<ApiResponse<{ ok: true; schedules: any[] }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/business/schedules'),
        method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        timeout: REQUEST_TIMEOUT,
        dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && Array.isArray((response.data as any)?.schedules)) {
        return { success: true, data: response.data as { ok: true; schedules: any[] } };
      }
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud schedule request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud schedule request unavailable' };
    }
  },
  async listPendingAccounts(token: string): Promise<ApiResponse<{ ok: true; accounts: Array<{ accountId: string; status: 'pending_authorization'; createdAt: string }> }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/miniapp/cloud-accounts'), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && Array.isArray((response.data as any)?.accounts)) return { success: true, data: response.data as { ok: true; accounts: Array<{ accountId: string; status: 'pending_authorization'; createdAt: string }> } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud account request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud account request unavailable' };
    }
  },
  async listAssignableProfiles(token: string, type: 'teacher' | 'student'): Promise<ApiResponse<{ ok: true; profiles: Array<{ id: string; name: string }> }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/miniapp/business-profiles?type=${encodeURIComponent(type)}`), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && Array.isArray((response.data as any)?.profiles)) return { success: true, data: response.data as { ok: true; profiles: Array<{ id: string; name: string }> } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud profile request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud profile request unavailable' };
    }
  },
  async assignAccountRole(token: string, accountId: string, role: 'teacher' | 'student', profileId: string, studentRelationship: 'student' | 'guardian' | null): Promise<ApiResponse<{ ok: true; account: { accountId: string; status: 'active'; roles: string[]; profile: { type: string; id: string } } }>> {
    if (typeof token !== 'string' || !token.trim() || typeof accountId !== 'string' || !accountId.trim() || typeof profileId !== 'string' || !profileId.trim()
      || (role === 'student' && studentRelationship !== 'student' && studentRelationship !== 'guardian')
      || (role !== 'student' && studentRelationship !== null)) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/miniapp/cloud-accounts/${encodeURIComponent(accountId)}/role`), method: 'PUT', data: { role, profileId, studentRelationship },
        header: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.account) return { success: true, data: response.data as { ok: true; account: { accountId: string; status: 'active'; roles: string[]; profile: { type: string; id: string } } } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud account authorization failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud account authorization unavailable' };
    }
  },
};

// ========== 认证 API ==========
export const authApi = {
  login: (data: { openid: string; name?: string }) =>
    api.post<{ token: string; user: any }>('/api/auth/login', data),
  refresh: (token: string) =>
    api.post<{ token: string }>('/api/auth/refresh', { token }),
};

export const desktopAuthorizationApi = {
  read: (challengeId: string) =>
    api.get<any>(`/api/desktop-identity/challenges/${encodeURIComponent(challengeId)}/public`),
  confirm: (payload: { challengeId: string; code: string; phone: string; expectedRowVersion: number }) =>
    api.post<any>(
      `/api/desktop-identity/challenges/${encodeURIComponent(payload.challengeId)}/confirm`,
      { code: payload.code, phone: payload.phone, expectedRowVersion: payload.expectedRowVersion },
    ),
};

// ========== 模块/权限 API ==========
export const moduleApi = {
  list: () => api.get<any[]>('/api/modules'),
  myPermissions: () => api.get<any[]>('/api/permissions/my'),
};

// ========== 管理员 API ==========
export const adminApi = {
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
  createMiniappTask: (taskType: string, payload: any) =>
    api.post<any>('/api/cloud/tasks', { taskType, payload }),
  getMiniappTaskResult: (taskId: string) =>
    api.get<any>(`/api/cloud/tasks/${taskId}/result`),
  readQuestionPreview: () => api.get<any>('/api/cloud/snapshots/questions'),
  createPaperTaskV2: (taskType: string, payload: any, targetHostDeviceId: string, idempotencyKey: string) =>
    api.post<any>('/api/cloud/tasks', { protocolVersion: 2, taskType, payload, targetHostDeviceId, idempotencyKey }),
  cancelMiniappTask: (taskId: string) => api.post<any>(`/api/cloud/tasks/${taskId}/cancel`, {}),
};

function accountPath(operation: string, resourceId?: string): string {
  const identity = Taro.getStorageSync('user_info');
  return accountExperiencePath(identity, operation, resourceId);
}

export const applicationApi = {
  mine: () => api.get<any>('/api/miniapp/applications/me'),
  submit: (
    request: { requestedRole: 'student' | 'teacher'; bindingHint?: string },
    idempotencyKey: string,
  ) =>
    api.postWithHeaders<any>(
      '/api/miniapp/applications',
      request,
      { 'x-idempotency-key': idempotencyKey },
    ),
};

export const authorityProjectionApi = {
  readCurrent: () => api.get<any>('/api/miniapp/projection'),
};

export const experienceApi = {
  questions: () => api.get<any>('/api/experience/questions'),
  createTask: (taskType: string, payload: any) =>
    api.post<any>(accountPath('createTask'), { taskType, payload }),
  getTaskResult: (taskId: string) =>
    api.get<any>(accountPath('taskResult', taskId)),
  cancelTask: (taskId: string) =>
    api.post<any>(accountPath('cancelTask', taskId), {}),
  artifactUrl: (artifactId: string) =>
    (() => {
      const path = accountPath('artifact', artifactId);
      return `${getRequestBaseUrl(path)}${path}`;
    })(),
  downloadArtifact: (artifactId: string) => {
    const sessionBoundary = createSessionBoundOperation(authSessionRuntime);
    return sessionBoundary.run((requestSession: any) => {
      const identity = Taro.getStorageSync('user_info');
      const request = accountExperienceArtifactRequest(identity, requestSession.token, artifactId);
      return Taro.downloadFile({
        url: `${getRequestBaseUrl(request.path)}${request.path}`,
        header: request.header,
      });
    });
  },
};

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
