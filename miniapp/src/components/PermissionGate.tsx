/**
 * 权限守卫组件
 * 根据用户权限控制子元素的显示/隐藏
 */

import { getCurrentUser, hasModuleAccess, hasPermission } from '../utils/permission';

interface Props {
  moduleId?: string;
  action?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function PermissionGate(props: Props) {
  const { moduleId, action, children, fallback } = props;
  const user = getCurrentUser();

  // 检查模块访问权限
  if (moduleId && !hasModuleAccess(moduleId)) {
    return <>{fallback || null}</>;
  }

  // 检查操作权限
  if (moduleId && action && !hasPermission(moduleId, action)) {
    return <>{fallback || null}</>;
  }

  return <>{children}</>;
}
