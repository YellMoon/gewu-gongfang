/**
 * 小程序端权限检查工具
 * 增强版：从后端 API 获取真实权限数据
 */
import Taro from '@tarojs/taro';
import { moduleApi } from './api';

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

export const adminModules = [
  'scheduling',
  'question-bank',
  'assets',
  'students',
  'courses',
  'teachers',
  'payments',
  'stats',
  'admin',
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

export const teacherModules = adminModules.filter(moduleId => moduleId !== 'admin');

export type MiniappRole = 'super_admin' | 'admin' | 'teacher' | 'student' | 'pending';
export type MiniappCapability =
  | 'users:review'
  | 'business:all'
  | 'business:teacher-scope'
  | 'question-bank:view'
  | 'question-bank:edit';

export function canMiniappWrite(target: string): boolean {
  return allowedWriteTasks.includes(target);
}

export function assertMiniappWriteAllowed(target: string): void {
  if (!canMiniappWrite(target)) {
    throw new Error('小程序仅允许提交财务导入、组卷和导出任务');
  }
}

export interface UserInfo {
  id: string;
  name: string;
  user_type: MiniappRole;
  avatar?: string;
  student_id?: string;
  studentId?: string;
  linked_student_id?: string;
  linkedStudentId?: string;
  linked_student_ids?: string[];
  linkedStudentIds?: string[];
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
const CACHE_KEY = 'user_permissions';

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
  return user?.user_type || 'pending';
}

/**
 * 是否是管理员
 */
export function isAdmin(): boolean {
  return ['super_admin', 'admin'].includes(getUserType());
}

export function isStudentUser(user: Partial<UserInfo> | null = getCurrentUser()): boolean {
  return user?.user_type === 'student';
}

export function getLinkedStudentIds(user: Partial<UserInfo> | null = getCurrentUser()): string[] {
  if (!user) return [];
  const ids = [
    user.student_id,
    user.studentId,
    user.linked_student_id,
    user.linkedStudentId,
    ...(user.linked_student_ids || []),
    ...(user.linkedStudentIds || []),
    user.user_type === 'student' ? user.id : undefined,
  ];
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

export function getMiniappRolePolicy(user: Partial<UserInfo> | null = getCurrentUser()) {
  if (user?.user_type === 'super_admin') {
    return {
      role: 'super_admin',
      modules: adminModules,
      readonlyScope: 'all',
      allowedWriteTasks,
      canReadAllSnapshots: true,
      capabilities: ['users:review', 'business:all', 'question-bank:view', 'question-bank:edit'] as MiniappCapability[],
    };
  }

  if (user?.user_type === 'admin') return {
    role: 'admin', modules: adminModules, readonlyScope: 'all', allowedWriteTasks,
    canReadAllSnapshots: true,
    capabilities: ['business:all', 'question-bank:view', 'question-bank:edit'] as MiniappCapability[],
  };

  if (user?.user_type === 'teacher') return {
    role: 'teacher', modules: teacherModules, readonlyScope: 'teacher', allowedWriteTasks,
    canReadAllSnapshots: false,
    capabilities: ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'] as MiniappCapability[],
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
    role: 'pending',
    modules: [],
    readonlyScope: 'none',
    allowedWriteTasks: [],
    canReadAllSnapshots: false,
    capabilities: [] as MiniappCapability[],
  };
}



/**
 * 从后端获取当前用户的权限列表
 * 优先从缓存读取，缓存未命中则请求 API
 */
export async function fetchPermissions(): Promise<PermissionData> {
  // 先尝试内存缓存
  if (_permissionCache) {
    return _permissionCache;
  }

  // 再尝试 storage 缓存
  try {
    const cached = Taro.getStorageSync(CACHE_KEY);
    if (cached && Array.isArray(cached.capabilities)) {
      _permissionCache = cached as PermissionData;
      return _permissionCache;
    }
  } catch { /* ignore */ }

  // 请求 API
  const res = await moduleApi.myPermissions();
  if (res.success && res.data) {
    const raw = res.data as any;
    const data = {
      permissions: raw.permissions || [],
      capabilities: raw.capabilities || [],
      user_type: raw.user_type || getUserType(),
    } as PermissionData;
    _permissionCache = data;
    try {
      Taro.setStorageSync(CACHE_KEY, data);
    } catch { /* ignore */ }
    return data;
  }

  // API 失败返回空权限
  return { permissions: [], capabilities: [], user_type: getUserType() };
}

/**
 * 检查是否有指定模块的权限
 * admin 类型跳过检查，全部返回 true
 * @param moduleId 模块 ID
 * @param action 操作类型，默认 'view'
 *
 * 题库模块 (question-bank) 权限级别说明：
 *   view = 做题(POST /records) + 查看 + 手动组卷(POST /question-sets) + 导出 + 批改
 *   edit = view 全部 + 创建/编辑/删除题目(questions CRUD) + 批量导入(POST /questions/batch) + 管理学科/章节/知识点
 *   admin = 全部
 *
 * 学生默认拥有 question-bank:view，可满足做题/组卷/查看需求
 */
export function hasModulePermission(moduleId: string, action: string = 'view'): boolean {
  const rolePolicy = getMiniappRolePolicy();
  if (!_permissionCache) {
    try {
      const cached = Taro.getStorageSync(CACHE_KEY);
      if (cached && Array.isArray(cached.capabilities)) _permissionCache = cached as PermissionData;
    } catch { /* ignore */ }
  }
  const roleCapabilities = _permissionCache?.capabilities || rolePolicy.capabilities;
  if (_permissionCache && roleCapabilities.length === 0) return false;
  if (moduleId === 'question-bank') {
    return roleCapabilities.includes(action === 'view' ? 'question-bank:view' : 'question-bank:edit');
  }
  if (roleCapabilities.includes('business:all') || roleCapabilities.includes('business:teacher-scope')) {
    return rolePolicy.modules.includes(moduleId);
  }
  if (rolePolicy.role === 'student') {
    return action === 'view' && rolePolicy.modules.includes(moduleId);
  }
  return false;
}

/**
 * 返回用户可访问的模块 ID 列表（有 view 权限的模块）
 * admin 返回所有已知模块
 */
export function getPermittedModules(): string[] {
  const rolePolicy = getMiniappRolePolicy();

  if (!_permissionCache) {
    try {
      const cached = Taro.getStorageSync(CACHE_KEY);
      if (cached && Array.isArray(cached.capabilities)) {
        _permissionCache = cached as PermissionData;
      }
    } catch { /* ignore */ }
  }

  const capabilities = _permissionCache?.capabilities || rolePolicy.capabilities;
  if (capabilities.length === 0) return [];
  return rolePolicy.modules;
}

/**
 * 清除权限缓存（登录/登出时调用）
 */
export function clearPermissionCache(): void {
  _permissionCache = null;
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
