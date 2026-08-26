/**
 * 小程序端权限检查工具
 * 增强版：从后端 API 获取真实权限数据
 */
import Taro from '@tarojs/taro';
import { miniappCloudBusinessApi } from './api';
import { authSessionRuntime } from './authSession';
import { cloudSessionUser } from '../pages/login/cloudSessionIdentityRuntime';
import {
  canUserSubmitMiniappWrite,
  deriveAccess,
  accountExperiencePolicy,
  sanitizeCapabilitiesForIdentity,
  studentSubjectIds,
} from './miniappAuthorizationRuntime';
import { createAuthorizationSession } from './miniappAuthorizationSession';
import { createPermissionFetchBoundary } from './miniappPermissionFetchRuntime';
import { clearBusinessCache, setBusinessCacheIdentity } from './storage';

export const readonlyModules = [
  'students',
  'courses',
  'schedule',
  'teachers',
  'payments',
  'consumptions',
  'question-bank',
  'finance-stats',
];

export const allowedWriteTasks = [
  'asset-import',
  'question-paper',
  'paper-export-word',
  'paper-export-pdf',
];

export const staffModules = [
  'scheduling',
  'question-bank',
  'assets',
  'students',
  'courses',
  'teachers',
  'payments',
  'stats',
];

export const studentModules = [
  'scheduling',
  'question-bank',
];

export const studentWriteTasks = [
  'question-paper',
  'paper-export-word',
  'paper-export-pdf',
];

export const teacherModules = staffModules.slice();

export type MiniappRole = 'super_admin' | 'teacher' | 'student' | 'visitor';
export type MiniappCapability =
  | 'business:all'
  | 'business:teacher-scope'
  | 'question-bank:view'
  | 'projection:read'
  | 'role-application:read'
  | 'role-application:submit'
  | 'question-preview:read'

export function canMiniappWrite(target: string, user: Partial<UserInfo> | null = getCurrentUser()): boolean {
  return canUserSubmitMiniappWrite(user, target, allowedWriteTasks);
}

export function assertMiniappWriteAllowed(target: string, user: Partial<UserInfo> | null = getCurrentUser()): void {
  if (!canMiniappWrite(target, user)) {
    throw new Error('小程序仅允许提交财务导入、组卷和导出任务');
  }
}

export interface UserInfo {
  id: string;
  name: string;
  user_type: MiniappRole;
  role?: MiniappRole;
  avatar?: string;
  tenant_id?: string;
  tenantId?: string;
  teacher_id?: string;
  teacherId?: string;
  student_id?: string;
  studentId?: string;
  linked_student_id?: string;
  linkedStudentId?: string;
  linked_student_ids?: string[];
  linkedStudentIds?: string[];
  account_state?: 'formal' | 'visitor';
  token_use?: 'miniapp-cloud' | 'miniapp-session' | 'miniapp-visitor';
  identity_kind?: string;
  authority_id?: string;
  capabilities?: MiniappCapability[];
  review_status?: string;
  reviewStatus?: string;
  status?: number | boolean;
  active?: number | boolean;
  login_enabled?: number | boolean;
  loginEnabled?: number | boolean;
  deleted?: number | boolean;
  disabled?: number | boolean;
}

export interface PermissionItem {
  id: string;
  module_id: string;
  action: string;
  description: string;
  status: number;
}

export interface PermissionData {
  permissions: PermissionItem[];
  capabilities: MiniappCapability[];
  user_type: string;
}

// 内存缓存
let _permissionCache: PermissionData | null = null;
export type PermissionLoadStatus = 'idle' | 'loaded' | 'error';
export interface PermissionState {
  status: PermissionLoadStatus;
  identityKey: string;
  capabilities: MiniappCapability[];
}
let _permissionState: PermissionState = { status: 'idle', identityKey: '', capabilities: [] };
const CACHE_KEY = 'user_permissions';
const authorizationSession = createAuthorizationSession({
  readCache: () => Taro.getStorageSync(CACHE_KEY) || null,
  writeCache: (value: any) => value ? Taro.setStorageSync(CACHE_KEY, value) : Taro.removeStorageSync(CACHE_KEY),
  clearPermissionCache: () => {
    _permissionCache = null;
    _permissionState = { status: 'idle', identityKey: '', capabilities: [] };
    Taro.removeStorageSync(CACHE_KEY);
  },
  clearBusinessCache,
  setBusinessCacheIdentity,
  writeUser: (user: any) => {
    const changed = authSessionRuntime.advanceIfIdentityChanges(user);
    Taro.setStorageSync('user_info', user);
    if (changed) authSessionRuntime.activate();
  },
  fetchRemote: async () => {
    const token = String(Taro.getStorageSync('auth_token') || '').trim();
    const response = await miniappCloudBusinessApi.readAuthorization(token);
    if (!response.success || !response.data) throw new Error(response.error || 'AUTHORIZATION_REFRESH_FAILED');
    const payload = response.data as any;
    const identity = cloudSessionUser(payload.identity);
    if (!identity) throw new Error('AUTHORIZATION_REFRESH_REJECTED');
    return { identity, capabilities: payload.capabilities || [] };
  },
  sanitizeCapabilities: sanitizeCapabilitiesForIdentity,
});

const permissionFetchBoundary = createPermissionFetchBoundary({
  getCurrentUser,
  getMemoryCache: () => _permissionCache,
  setMemoryCache: (value: PermissionData | null) => { _permissionCache = value; },
  setPermissionState: (value: PermissionState) => { _permissionState = value; },
  refreshAuthorization: (localUser: UserInfo | null) => authorizationSession.refresh(localUser, { force: true }),
});

export function getPermissionState(): PermissionState {
  return { ..._permissionState, capabilities: [..._permissionState.capabilities] };
}

export function getEffectiveMiniappAccess(user: Partial<UserInfo> | null = getCurrentUser()) {
  return deriveAccess(user, _permissionState);
}

/**
 * 获取当前用户信息
 */
export function getCurrentUser(): UserInfo | null {
  try {
    return Taro.getStorageSync('user_info') || null;
  } catch {
    return null;
  }
}

/**
 * 获取用户类型
 */
export function getUserType(): string {
  const user = getCurrentUser();
  return user?.user_type || 'visitor';
}

/**
 * 是否是管理员
 */
export function isAdmin(): boolean {
  return getUserType() === 'super_admin';
}

export function isStudentUser(user: Partial<UserInfo> | null = getCurrentUser()): boolean {
  return user?.user_type === 'student';
}

export function getLinkedStudentIds(user: Partial<UserInfo> | null = getCurrentUser()): string[] {
  return studentSubjectIds(user);
}

export function getMiniappRolePolicy(user: Partial<UserInfo> | null = getCurrentUser()) {
  const experiencePolicy = accountExperiencePolicy(user);
  if (experiencePolicy) return experiencePolicy;
  if (user?.user_type === 'super_admin') {
    return {
      role: 'super_admin',
      modules: staffModules,
      readonlyScope: 'all',
      allowedWriteTasks,
      canReadAllSnapshots: true,
      capabilities: ['business:all', 'question-bank:view'] as MiniappCapability[],
    };
  }

  if (user?.user_type === 'teacher') return {
    role: 'teacher', modules: teacherModules, readonlyScope: 'teacher', allowedWriteTasks,
    canReadAllSnapshots: false,
    capabilities: ['business:teacher-scope', 'question-bank:view'] as MiniappCapability[],
  };

  if (user?.user_type === 'student') {
    return {
      role: 'student',
      modules: studentModules,
      readonlyScope: 'linked-student',
      linkedStudentIds: getLinkedStudentIds(user),
      allowedWriteTasks: studentWriteTasks,
      canReadAllSnapshots: false,
      capabilities: ['question-bank:view'] as MiniappCapability[],
    };
  }

  return {
    role: 'visitor',
    modules: [],
    readonlyScope: 'none',
    allowedWriteTasks: [],
    canReadAllSnapshots: false,
    capabilities: [] as MiniappCapability[],
  };
}



/**
 * Refresh permissions from the authenticated server. Persistent data is never authoritative.
 */
export async function fetchPermissions(): Promise<PermissionData> {
  return permissionFetchBoundary.fetchPermissions();
}

/**
 * Server-verified capability checks only. The persistent record is a rendering hint
 * and is never promoted into the in-memory verified state without a network refresh.
 */
export function hasModulePermission(moduleId: string, action: string = 'view'): boolean {
  const access = getEffectiveMiniappAccess();
  const roleCapabilities = access.capabilities as MiniappCapability[];
  if (moduleId === 'question-bank') return action === 'view' && roleCapabilities.includes('question-bank:view');
  return access.modules.includes(moduleId) && action === 'view';
}

/**
 * 返回用户可访问的模块 ID 列表（有 view 权限的模块）
 * admin 返回所有已知模块
 */
export function getPermittedModules(): string[] {
  return getEffectiveMiniappAccess().modules;
}

/**
 * 清除权限缓存（登录/登出时调用）
 */
export function clearPermissionCache(): void {
  _permissionCache = null;
  _permissionState = { status: 'idle', identityKey: '', capabilities: [] };
  try {
    Taro.removeStorageSync(CACHE_KEY);
  } catch { /* ignore */ }
}

// ========== 以下是保留的旧接口兼容 ==========

/**
 * 检查是否有指定模块的访问权限（兼容旧接口）
 */
export function hasModuleAccess(moduleId: string): boolean {
  return hasModulePermission(moduleId, 'view');
}

/**
 * 检查是否有指定操作的权限（兼容旧接口）
 */
export function hasPermission(moduleId: string, action: string): boolean {
  return hasModulePermission(moduleId, action);
}
