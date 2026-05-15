export function getApiBase(path = '/api/question-bank'): string {
  const configured = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');
  if (configured) {
    return configured.endsWith('/api') ? `${configured}${path.replace(/^\/api/, '')}` : `${configured}${path}`;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (protocol === 'file:' || (hostname === 'localhost' && port === '3000')) {
      return `http://localhost:3001${path}`;
    }
  }
  return path;
}
