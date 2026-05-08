import { View, Text } from '@tarojs/components';
import { hasModulePermission } from '../../utils/permission';
import './index.scss';

interface PermissionGuardProps {
  moduleId: string;
  action?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export default function PermissionGuard({
  moduleId,
  action = 'view',
  fallback,
  children,
}: PermissionGuardProps) {
  const permitted = hasModulePermission(moduleId, action);

  if (permitted) {
    return <>{children}</>;
  }

  if (fallback) {
    return (
      <View className="permission-fallback">
        {fallback}
      </View>
    );
  }

  return null;
}
