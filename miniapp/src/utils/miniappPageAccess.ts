import { getCurrentUser, getEffectiveMiniappAccess, getMiniappRolePolicy, fetchPermissions } from './permission';
import { canOpenMiniappRoute } from './miniappRouteAccess';

export function canAccessMiniappPage(route: string): boolean {
  return !!getCurrentUser() && canOpenMiniappRoute(route, getEffectiveMiniappAccess());
}

export async function refreshMiniappPageAccess(route: string): Promise<boolean> {
  if (canAccessMiniappPage(route)) return true;
  const user = getCurrentUser();
  // The role policy only decides whether to request verification; it grants no access.
  if (!user || !canOpenMiniappRoute(route, getMiniappRolePolicy(user))) return false;
  try {
    await fetchPermissions();
  } catch {
    return false;
  }
  return canAccessMiniappPage(route);
}
