const assert = require('assert');

async function main() {
  const { readDesktopAuthorizationSession } = await import('./desktopAuthorizationSession.mjs');
  const storage = { getItem: key => key === 'gewu_desktop_authorization_session'
    ? JSON.stringify({ token:'jwt-1', user:{ id:'u1' }, deviceId:'d1' }) : null };
  assert.deepStrictEqual(readDesktopAuthorizationSession(storage), {
    authorization:'Bearer jwt-1', authContext:{ userId:'u1', deviceId:'d1' },
  });
  assert.throws(() => readDesktopAuthorizationSession({ getItem:()=>null }), e => e.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
  console.log('desktop authorization session tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
