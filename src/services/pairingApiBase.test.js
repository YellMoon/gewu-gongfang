const assert=require('assert');
(async()=>{const{resolvePairingApiBase}=await import('./pairingApiBase.mjs');
assert.strictEqual(resolvePairingApiBase({hostBaseUrl:'http://192.168.1.2:3001'}, {protocol:'file:',origin:'null'}),'http://192.168.1.2:3001');
assert.strictEqual(resolvePairingApiBase({cloudBaseUrl:'https://cloud.example.com/api'}, {protocol:'file:',origin:'null'}),'https://cloud.example.com');
assert.strictEqual(resolvePairingApiBase({}, {protocol:'https:',origin:'https://app.example.com'}),'https://app.example.com');
assert.throws(()=>resolvePairingApiBase({}, {protocol:'file:',origin:'null'}),e=>e.code==='PAIRING_API_BASE_REQUIRED');
console.log('pairing API base tests passed');})().catch(e=>{console.error(e);process.exit(1);});
