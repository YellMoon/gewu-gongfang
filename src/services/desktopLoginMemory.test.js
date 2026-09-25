'use strict';
// UTF-8: remember the account name/phone locally and mask the phone's middle four digits for display.
const assert = require('node:assert/strict');

(async () => {
  const { maskPhone, loadRememberedLogin, saveRememberedLogin } = await import('./desktopLoginMemory.mjs');

  assert.equal(maskPhone('13732250653'), '137****0653');
  assert.equal(maskPhone('123'), '123');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone(null), '');

  const memory = new Map();
  const storage = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
  assert.equal(loadRememberedLogin(storage), null);
  saveRememberedLogin({ type: 'phone', value: '13732250653' }, storage);
  assert.deepEqual(loadRememberedLogin(storage), { type: 'phone', value: '13732250653' });
  saveRememberedLogin({ type: 'account_name', value: 'teacher.a' }, storage);
  assert.deepEqual(loadRememberedLogin(storage), { type: 'account_name', value: 'teacher.a' });
  saveRememberedLogin({ type: 'phone', value: '   ' }, storage);
  assert.deepEqual(loadRememberedLogin(storage), { type: 'account_name', value: 'teacher.a' });

  console.log('desktop login memory tests passed');
})().catch(error => { console.error(error); process.exit(1); });
