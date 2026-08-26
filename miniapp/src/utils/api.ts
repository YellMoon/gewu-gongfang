import Taro from '@tarojs/taro';

declare const __CLOUD_BUSINESS_API_BASE_URL__: string | undefined;
const DEFAULT_CLOUD_BUSINESS_BASE_URL = (typeof __CLOUD_BUSINESS_API_BASE_URL__ !== 'undefined' && __CLOUD_BUSINESS_API_BASE_URL__)
  ? __CLOUD_BUSINESS_API_BASE_URL__.replace(/\/+$/, '')
  : 'https://physicsedu.xyz/cloud-business';
const REQUEST_TIMEOUT = 30000;

function cloudBusinessUrl(path: string): string {
  return `${DEFAULT_CLOUD_BUSINESS_BASE_URL}${path}`;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  total?: number;
  code?: number | string;
}

export const miniappCloudAuthApi = {
  async login(loginCode: string, phoneCode: string): Promise<ApiResponse<{ ok: true; token: string; identity: any }>> {
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
  async readAuthorization(token: string): Promise<ApiResponse<{ ok: true; identity: any; capabilities: string[] }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/miniapp/cloud-context'), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && Array.isArray((response.data as any)?.capabilities)) {
        return { success: true, data: response.data as { ok: true; identity: any; capabilities: string[] } };
      }
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud authorization request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud authorization request unavailable' };
    }
  },
  async readRoleApplication(token: string): Promise<ApiResponse<{ ok: true; state: string; application: any | null }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/miniapp/role-applications/me'), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true) return { success: true, data: response.data as { ok: true; state: string; application: any | null } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud role application request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud role application request unavailable' };
    }
  },
  async submitRoleApplication(token: string, request: { requestedIdentity: 'teacher' | 'student' | 'family_member'; profileMode: 'existing' | 'new'; bindingHint: string }, idempotencyKey: string): Promise<ApiResponse<{ ok: true; state: string; application: any }>> {
    if (typeof token !== 'string' || !token.trim() || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/miniapp/role-applications'), method: 'POST', data: request,
        header: { Authorization: `Bearer ${token}`, 'x-idempotency-key': idempotencyKey, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.application) return { success: true, data: response.data as { ok: true; state: string; application: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud role application submission failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud role application submission unavailable' };
    }
  },
  async readBusinessProjection(token: string): Promise<ApiResponse<{ ok: true; projection: any }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/business/miniapp-projection'),
        method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        timeout: REQUEST_TIMEOUT,
        dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.projection) {
        return { success: true, data: response.data as { ok: true; projection: any } };
      }
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud business projection request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud business projection request unavailable' };
    }
  },
  async listQuestionPreviews(token: string): Promise<ApiResponse<{ ok: true; questions: any[] }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/business/miniapp-question-previews'), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && Array.isArray((response.data as any)?.questions)) return { success: true, data: response.data as { ok: true; questions: any[] } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || '\u9898\u5e93\u6d4f\u89c8\u670d\u52a1\u6682\u4e0d\u53ef\u7528' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || '\u9898\u5e93\u6d4f\u89c8\u670d\u52a1\u6682\u4e0d\u53ef\u7528' };
    }
  },
  async requestQuestionAssetDelivery(token: string, questionId: string, assetKey: string): Promise<ApiResponse<{ ok: true; delivery: any }>> {
    if (typeof token !== 'string' || !token.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(questionId || '')) || !/^[0-9a-f]{64}$/.test(String(assetKey || ''))) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/business/miniapp-question-assets/${encodeURIComponent(assetKey)}/delivery`), method: 'POST', data: { questionId },
        header: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.delivery) return { success: true, data: response.data as { ok: true; delivery: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud question asset request failed' };
    } catch (error: any) { return { success: false, error: error?.errMsg || error?.message || 'Cloud question asset request unavailable' }; }
  },
  async readQuestionAssetDelivery(token: string, deliveryId: string): Promise<ApiResponse<{ ok: true; delivery: any }>> {
    if (typeof token !== 'string' || !token.trim() || !/^question_asset_delivery_[A-Za-z0-9_-]{8,128}$/.test(String(deliveryId || ''))) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/business/miniapp-question-asset-deliveries/${encodeURIComponent(deliveryId)}`), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.delivery) return { success: true, data: response.data as { ok: true; delivery: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud question asset status failed' };
    } catch (error: any) { return { success: false, error: error?.errMsg || error?.message || 'Cloud question asset status unavailable' }; }
  },
  async downloadQuestionAssetDelivery(token: string, deliveryId: string): Promise<ApiResponse<{ tempFilePath: string }>> {
    if (typeof token !== 'string' || !token.trim() || !/^question_asset_delivery_[A-Za-z0-9_-]{8,128}$/.test(String(deliveryId || ''))) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.downloadFile({
        url: cloudBusinessUrl(`/api/business/miniapp-question-asset-deliveries/${encodeURIComponent(deliveryId)}/download`),
        header: { Authorization: `Bearer ${token}` }, timeout: REQUEST_TIMEOUT,
      });
      if (response.statusCode === 200 && typeof response.tempFilePath === 'string' && response.tempFilePath) return { success: true, data: { tempFilePath: response.tempFilePath } };
      return { success: false, error: `Cloud question asset download failed (${response.statusCode})` };
    } catch (error: any) { return { success: false, error: error?.errMsg || error?.message || 'Cloud question asset download unavailable' }; }
  },
  async createPaperExportTask(token: string, taskType: 'paper-export-word' | 'paper-export-pdf', request: any, idempotencyKey: string): Promise<ApiResponse<{ ok: true; task: any }>> {
    if (typeof token !== 'string' || !token.trim() || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/business/miniapp-paper-export-tasks'), method: 'POST', data: { taskType, request },
        header: { Authorization: `Bearer ${token}`, 'x-idempotency-key': idempotencyKey, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.task) return { success: true, data: response.data as { ok: true; task: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud paper export request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud paper export request unavailable' };
    }
  },
  async readPaperExportTask(token: string, taskId: string): Promise<ApiResponse<{ ok: true; task: any }>> {
    if (typeof token !== 'string' || !token.trim() || typeof taskId !== 'string' || !taskId.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/business/miniapp-paper-export-tasks/${encodeURIComponent(taskId)}`), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.task) return { success: true, data: response.data as { ok: true; task: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud paper export task request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud paper export task request unavailable' };
    }
  },
  async cancelPaperExportTask(token: string, taskId: string): Promise<ApiResponse<{ ok: true; task: any }>> {
    if (typeof token !== 'string' || !token.trim() || typeof taskId !== 'string' || !taskId.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/business/miniapp-paper-export-tasks/${encodeURIComponent(taskId)}/cancel`), method: 'POST', data: {},
        header: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.task) return { success: true, data: response.data as { ok: true; task: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud paper export cancel failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud paper export cancel unavailable' };
    }
  },
  async requestPaperExportDelivery(token: string, taskId: string): Promise<ApiResponse<{ ok: true; delivery: any }>> {
    if (typeof token !== 'string' || !token.trim() || typeof taskId !== 'string' || !taskId.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/business/miniapp-paper-export-tasks/${encodeURIComponent(taskId)}/delivery`), method: 'POST', data: {},
        header: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.delivery) return { success: true, data: response.data as { ok: true; delivery: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud export delivery request failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud export delivery request unavailable' };
    }
  },
  async readPaperExportDelivery(token: string, deliveryId: string): Promise<ApiResponse<{ ok: true; delivery: any }>> {
    if (typeof token !== 'string' || !token.trim() || typeof deliveryId !== 'string' || !deliveryId.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl(`/api/business/miniapp-artifact-deliveries/${encodeURIComponent(deliveryId)}`), method: 'GET',
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.delivery) return { success: true, data: response.data as { ok: true; delivery: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud export delivery status failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud export delivery status unavailable' };
    }
  },
  async downloadPaperExportDelivery(token: string, deliveryId: string): Promise<ApiResponse<{ tempFilePath: string; statusCode: number }>> {
    if (typeof token !== 'string' || !token.trim() || typeof deliveryId !== 'string' || !deliveryId.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.downloadFile({
        url: cloudBusinessUrl(`/api/business/miniapp-artifact-deliveries/${encodeURIComponent(deliveryId)}/download`),
        header: { Authorization: `Bearer ${token}` }, timeout: REQUEST_TIMEOUT,
      });
      if (response.statusCode === 200 && typeof response.tempFilePath === 'string' && response.tempFilePath) return { success: true, data: { tempFilePath: response.tempFilePath, statusCode: response.statusCode } };
      return { success: false, error: `Cloud export download failed (${response.statusCode})` };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud export download unavailable' };
    }
  },
  async importPersonalAssets(token: string, records: any[], idempotencyKey: string): Promise<ApiResponse<{ ok: true; receipt: any }>> {
    if (typeof token !== 'string' || !token.trim() || !Array.isArray(records) || records.length < 1 || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) return { success: false, error: 'Cloud session required' };
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/business/miniapp-personal-assets/import'), method: 'POST', data: { records },
        header: { Authorization: `Bearer ${token}`, 'x-idempotency-key': idempotencyKey, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && (response.data as any)?.ok === true && (response.data as any)?.receipt) return { success: true, data: response.data as { ok: true; receipt: any } };
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Cloud personal asset import failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Cloud personal asset import unavailable' };
    }
  },
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
};

// ========== 认证 API ==========
