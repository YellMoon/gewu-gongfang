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
  user_type: 'admin' | 'teacher' | 'student' | 'invited';
  avatar?: string;
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
  return user?.user_type || 'student';
}

/**
 * 是否是管理员
 */
export function isAdmin(): boolean {
  return getUserType() === 'admin';
}

/**
 * 是否是被邀请者
 */
export function isInvited(): boolean {
  return getUserType() === 'invited';
}

/**
 * 检查当前用户是否可以访问资产模块
 * 规则：仅 admin 和 invited 可访问
 */
export function canAccessAssets(): boolean {
  const type = getUserType();
  return type === 'admin' || type === 'invited';
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
    if (cached && cached.permissions) {
      _permissionCache = cached as PermissionData;
      return _permissionCache;
    }
  } catch { /* ignore */ }

  // 请求 API
  const res = await moduleApi.myPermissions();
  if (res.success && res.data) {
    const data = res.data as unknown as PermissionData;
    _permissionCache = data;
    try {
      Taro.setStorageSync(CACHE_KEY, data);
    } catch { /* ignore */ }
    return data;
  }

  // API 失败返回空权限
  return { permissions: [], user_type: getUserType() };
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
  // 管理员全权限
  if (isAdmin()) return true;

  if (!_permissionCache) {
    // 未加载权限时尝试同步读 storage
    try {
      const cached = Taro.getStorageSync(CACHE_KEY);
      if (cached && cached.permissions) {
        _permissionCache = cached as PermissionData;
      }
    } catch { /* ignore */ }
  }

  if (!_permissionCache) return false;

  return _permissionCache.permissions.some(
    (p) => p.module_id === moduleId && p.action === action && p.status === 1
  );
}

/**
 * 返回用户可访问的模块 ID 列表（有 view 权限的模块）
 * admin 返回所有已知模块
 */
export function getPermittedModules(): string[] {
  if (isAdmin()) {
    return ['scheduling', 'question-bank', 'teaching-tools', 'assets'];
  }

  if (!_permissionCache) {
    try {
      const cached = Taro.getStorageSync(CACHE_KEY);
      if (cached && cached.permissions) {
        _permissionCache = cached as PermissionData;
      }
    } catch { /* ignore */ }
  }

  if (!_permissionCache) return [];

  const moduleIds = new Set<string>();
  _permissionCache.permissions
    .filter((p) => p.action === 'view' && p.status === 1)
    .forEach((p) => moduleIds.add(p.module_id));

  return Array.from(moduleIds);
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
