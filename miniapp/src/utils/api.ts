import Taro from '@tarojs/taro';
// @ts-ignore CommonJS runtime is shared with direct Node pagination tests.
import * as questionBasketHydrationRuntime from './questionBasketHydrationRuntime';

declare const __CLOUD_BUSINESS_API_BASE_URL__: string | undefined;
const DEFAULT_CLOUD_BUSINESS_BASE_URL = (typeof __CLOUD_BUSINESS_API_BASE_URL__ !== 'undefined' && __CLOUD_BUSINESS_API_BASE_URL__)
  ? __CLOUD_BUSINESS_API_BASE_URL__.replace(/\/+$/, '')
  : 'https://physicsedu.xyz/cloud-business';
const REQUEST_TIMEOUT = 30000;
const fetchQuestionPreviewsByIds = questionBasketHydrationRuntime.fetchQuestionPreviewsByIds as (
  ids: string[],
  dependencies: { pageSize?: number; fetchPage: (options: { limit: number; cursor?: string }) => Promise<any> },
) => Promise<{ success: boolean; questions: any[]; unavailableIds: string[]; unresolvedIds: string[]; pagesFetched: number; error?: string }>;

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
  async confirmDesktopLogin(desktopLogin: { scene: string }, loginCode: string, phoneCode: string): Promise<ApiResponse<{ ok: true; status: 'verified' }>> {
    if (!desktopLogin || typeof desktopLogin !== 'object' || Array.isArray(desktopLogin)
      || Object.keys(desktopLogin).length !== 1 || !/^d_[A-Za-z0-9_-]{30}$/u.test(desktopLogin.scene)
      || ![loginCode, phoneCode].every(value => typeof value === 'string' && value.trim())) {
      return { success: false, code: 'CLOUD_DESKTOP_PAIRING_REJECTED', error: 'Desktop login request is invalid' };
    }
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/desktop/pairing/confirm'),
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        data: { scene: desktopLogin.scene, loginCode, phoneCode },
        timeout: REQUEST_TIMEOUT,
        dataType: 'json',
      });
      if (response.statusCode >= 200 && response.statusCode < 300
        && (response.data as any)?.ok === true && (response.data as any)?.status === 'verified') {
        return { success: true, data: response.data as { ok: true; status: 'verified' } };
      }
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || 'Desktop login confirmation failed' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || 'Desktop login confirmation unavailable' };
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
  async submitRoleApplication(token: string, request: { requestedIdentity: 'teacher' | 'student' | 'family_member'; profileMode: 'existing' | 'new'; profileName: string; profilePhone: string }, idempotencyKey: string): Promise<ApiResponse<{ ok: true; state: string; application: any }>> {
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
  async listQuestionPreviews(token: string, options: {
    limit?: number;
    cursor?: string;
    subject?: string;
    query?: string;
    source?: string;
    knowledgePoint?: string;
    type?: string;
    difficulty?: number;
    grade?: string;
    semester?: string;
    examType?: string;
    examYear?: string;
  } = {}): Promise<ApiResponse<{
    ok: true;
    hasMore: boolean;
    nextCursor: string | null;
    total: number;
    filterOptions: {
      subjects: string[];
      types: string[];
      sources: string[];
      knowledgePoints: string[];
      difficulties: number[];
      grades: string[];
      semesters: string[];
      examTypes: string[];
      examYears: string[];
    };
    questions: any[];
  }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200)) {
      return { success: false, error: 'Question preview page size is invalid' };
    }
    if (options.cursor !== undefined && (typeof options.cursor !== 'string' || !options.cursor.trim())) {
      return { success: false, error: 'Question preview cursor is invalid' };
    }
    const textLimits: Array<[keyof typeof options, number]> = [
      ['subject', 128], ['query', 512], ['source', 256], ['knowledgePoint', 256], ['type', 128],
      ['grade', 128], ['semester', 128], ['examType', 128], ['examYear', 64],
    ];
    if (textLimits.some(([key, maximum]) => options[key] !== undefined
      && (typeof options[key] !== 'string' || !String(options[key]).trim() || String(options[key]).trim().length > maximum))) {
      return { success: false, error: 'Question preview filter is invalid' };
    }
    if (!options.subject && (options.query || options.source || options.knowledgePoint || options.type || options.difficulty !== undefined
      || options.grade || options.semester || options.examType || options.examYear)) {
      return { success: false, error: 'Question preview subject is required before filtering' };
    }
    if (options.difficulty !== undefined && (!Number.isInteger(options.difficulty) || options.difficulty < 1 || options.difficulty > 5)) {
      return { success: false, error: 'Question preview difficulty is invalid' };
    }
    const requestData = Object.fromEntries(Object.entries({
      limit: options.limit,
      cursor: options.cursor,
      subject: options.subject,
      query: options.query,
      source: options.source,
      knowledgePoint: options.knowledgePoint,
      type: options.type,
      difficulty: options.difficulty,
      grade: options.grade,
      semester: options.semester,
      examType: options.examType,
      examYear: options.examYear,
    }).filter(([, value]) => value !== undefined));
    try {
      const response = await Taro.request({
        url: cloudBusinessUrl('/api/business/miniapp-question-previews'), method: 'GET',
        data: requestData,
        header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, timeout: REQUEST_TIMEOUT, dataType: 'json',
      });
      const data = response.data as any;
      const validCursor = data?.nextCursor === undefined || data?.nextCursor === null || typeof data.nextCursor === 'string';
      if (response.statusCode >= 200 && response.statusCode < 300 && data?.ok === true && Array.isArray(data.questions) && (data.hasMore === undefined || typeof data.hasMore === 'boolean') && validCursor) {
        const stringValues = (value: unknown): string[] => Array.isArray(value)
          ? Array.from(new Set<string>(value.map(item => {
            if (typeof item === 'string') return item.trim();
            if (typeof item === 'number' && Number.isFinite(item)) return String(item);
            return '';
          }).filter(Boolean)))
          : [];
        const difficultyValues = (value: unknown): number[] => Array.isArray(value)
          ? Array.from(new Set<number>(value.map(item => Number(item)).filter(item => Number.isInteger(item) && item >= 1 && item <= 5))).sort((left, right) => left - right)
          : [];
        const fallbackQuestions = (data.questions as any[]).map(question => ({
          ...question,
          sourceLabel: typeof question?.sourceLabel === 'string' ? question.sourceLabel.trim() : '',
          region: typeof question?.region === 'string' ? question.region.trim() : '',
          school: typeof question?.school === 'string' ? question.school.trim() : '',
          examType: typeof question?.examType === 'string'
            ? question.examType.trim()
            : (typeof question?.exam_type === 'string' ? question.exam_type.trim() : ''),
          examYear: question?.examYear ?? question?.exam_year ?? '',
          grade: typeof question?.grade === 'string' ? question.grade.trim() : '',
          semester: typeof question?.semester === 'string' ? question.semester.trim() : '',
        }));
        const rawFilterOptions = data.filterOptions && typeof data.filterOptions === 'object' ? data.filterOptions : {};
        const filterOptions = {
          subjects: stringValues(rawFilterOptions.subjects).length ? stringValues(rawFilterOptions.subjects) : stringValues(fallbackQuestions.map(question => question?.subject)),
          types: stringValues(rawFilterOptions.types).length ? stringValues(rawFilterOptions.types) : stringValues(fallbackQuestions.map(question => question?.type)),
          sources: stringValues(rawFilterOptions.sources).length ? stringValues(rawFilterOptions.sources) : stringValues(fallbackQuestions.map(question => question?.source)),
          knowledgePoints: stringValues(rawFilterOptions.knowledgePoints).length ? stringValues(rawFilterOptions.knowledgePoints) : stringValues(fallbackQuestions.flatMap(question => question?.knowledgeLabels || [])),
          difficulties: Array.isArray(rawFilterOptions.difficulties)
            ? difficultyValues(rawFilterOptions.difficulties)
            : difficultyValues(fallbackQuestions.map(question => question?.difficulty)),
          grades: stringValues(rawFilterOptions.grades).length ? stringValues(rawFilterOptions.grades) : stringValues(fallbackQuestions.map(question => question?.grade)),
          semesters: stringValues(rawFilterOptions.semesters).length ? stringValues(rawFilterOptions.semesters) : stringValues(fallbackQuestions.map(question => question?.semester)),
          examTypes: stringValues(rawFilterOptions.examTypes).length ? stringValues(rawFilterOptions.examTypes) : stringValues(fallbackQuestions.map(question => question?.examType)),
          examYears: stringValues(rawFilterOptions.examYears).length ? stringValues(rawFilterOptions.examYears) : stringValues(fallbackQuestions.map(question => question?.examYear)),
        };
        return { success: true, data: {
          ok: true,
          hasMore: data.hasMore === true,
          nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
          total: Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : data.questions.length,
          filterOptions,
          questions: fallbackQuestions,
        } };
      }
      return { success: false, code: (response.data as any)?.code, error: (response.data as any)?.error || '\u9898\u5e93\u6d4f\u89c8\u670d\u52a1\u6682\u4e0d\u53ef\u7528' };
    } catch (error: any) {
      return { success: false, error: error?.errMsg || error?.message || '\u9898\u5e93\u6d4f\u89c8\u670d\u52a1\u6682\u4e0d\u53ef\u7528' };
    }
  },
  async listQuestionPreviewsByIds(token: string, questionIds: string[]): Promise<ApiResponse<{
    ok: true;
    questions: any[];
    unavailableIds: string[];
    pagesFetched: number;
  }>> {
    if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Cloud session required' };
    const result = await fetchQuestionPreviewsByIds(questionIds, {
      pageSize: 200,
      fetchPage: options => miniappCloudBusinessApi.listQuestionPreviews(token, options),
    });
    if (!result.success) {
      return { success: false, error: result.error || '\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210' };
    }
    return {
      success: true,
      data: {
        ok: true,
        questions: result.questions,
        unavailableIds: result.unavailableIds,
        pagesFetched: result.pagesFetched,
      },
    };
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
