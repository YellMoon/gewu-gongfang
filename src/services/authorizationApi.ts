import { getApiBase } from '../utils/apiBase';
import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';

export type AuthorizationRole = 'super_admin' | 'admin' | 'teacher' | 'student' | 'pending';
export type ReviewableRole = 'admin' | 'teacher' | 'student';
export interface AuthorizationUser { id: string; phone?: string; name?: string; nickname?: string; role: AuthorizationRole; review_status: string; status: number; login_enabled: number; teacher_id?: string | null; student_id?: string | null; binding_error?: string; }
export interface UserListQuery { search?: string; role?: string; status?: string; page?: number; pageSize?: number; }

function requestHeaders(json = false): HeadersInit {
  const session = readDesktopAuthorizationSession();
  return { Authorization: session.authorization, 'x-device-id': session.authContext.deviceId, ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function request(path: string, init: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(getApiBase(path), { ...init, headers: { ...requestHeaders(Boolean(init.body)), ...(init.headers || {}) } }); }
  catch (_error) { throw Object.assign(new Error('NETWORK_ERROR'), { code: 'NETWORK_ERROR' }); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw Object.assign(new Error(data.message || data.code || 'REQUEST_FAILED'), { code: data.code || 'REQUEST_FAILED', status: response.status });
  return data;
}

export async function listUsers(query: UserListQuery = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== '' && value !== undefined) params.set(key, String(value)); });
  const data = await request(`/api/admin/users${params.toString() ? `?${params}` : ''}`);
  return { users: (data.users || data.data?.items || []) as AuthorizationUser[], total: Number(data.total ?? data.data?.total ?? 0) };
}
export async function reviewUser(userId: string, role: ReviewableRole) {
  const data = await request(`/api/admin/users/${encodeURIComponent(userId)}/review`, { method: 'PATCH', body: JSON.stringify({ role }) });
  return (data.user || data.data?.user) as AuthorizationUser;
}
export async function disableUser(userId: string) {
  const data = await request(`/api/admin/users/${encodeURIComponent(userId)}/disable`, { method: 'PATCH' });
  return (data.user || data.data?.user) as AuthorizationUser;
}
export async function getMyCapabilities() {
  const data = await request('/api/permissions/my');
  return (data.capabilities || data.data?.capabilities || []) as string[];
}
