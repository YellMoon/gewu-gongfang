// UTF-8: remember the last account name or phone locally and mask the phone's middle digits for display.
const LOGIN_MEMORY_KEY = 'desktop_login_memory_v1';

export function maskPhone(phone) {
  const value = String(phone || '').trim();
  if (!/^\d{11}$/u.test(value)) return value;
  return `${value.slice(0, 3)}****${value.slice(7)}`;
}

export function loadRememberedLogin(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(LOGIN_MEMORY_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const type = parsed.type === 'account_name' ? 'account_name' : 'phone';
    const value = typeof parsed.value === 'string' ? parsed.value.trim() : '';
    if (!value || value.length > 256) return null;
    return { type, value };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(login, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  if (!storage || !login) return;
  const type = login.type === 'account_name' ? 'account_name' : 'phone';
  const value = String(login.value || '').trim();
  if (!value || value.length > 256) return;
  try {
    storage.setItem(LOGIN_MEMORY_KEY, JSON.stringify({ type, value }));
  } catch {
    // Best effort only.
  }
}
