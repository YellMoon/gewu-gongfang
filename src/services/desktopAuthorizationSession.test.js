const assert = require('assert');

async function main() {
  const { readDesktopAuthorizationSession, startPairing, pollOrExchange } = await import('./desktopAuthorizationSession.mjs');
  const storage = { getItem: key => key === 'gewu_desktop_authorization_session'
    ? JSON.stringify({ token:'jwt-1', user:{ id:'u1' }, deviceId:'d1' }) : null };
  assert.deepStrictEqual(readDesktopAuthorizationSession(storage), {
    authorization:'Bearer jwt-1', authContext:{ userId:'u1', deviceId:'d1' },
  });
  assert.throws(() => readDesktopAuthorizationSession({ getItem:()=>null }), e => e.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
  const values=new Map();const writable={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const pending=await startPairing({baseUrl:'http://host',phone:'13000000000',deviceId:'d1',deviceName:'PC'},{storage:writable,fetchImpl:async()=>({ok:true,json:async()=>({success:true,pairing:{id:'p1',pairingCode:'123456',expiresAt:'later'}})})});
  assert.strictEqual(pending.pairingCode,'123456');
  await pollOrExchange({storage:writable,fetchImpl:async()=>({ok:true,json:async()=>({success:true,token:'jwt',userId:'u1',deviceId:'d1'})})});
  assert.strictEqual(readDesktopAuthorizationSession(writable).authorization,'Bearer jwt');
  console.log('desktop authorization session tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
