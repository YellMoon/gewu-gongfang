const assert = require('assert');

(async () => {
  const { deviceStatusPresentation } = await import('./deviceStatusPresentation.mjs');

  assert.deepStrictEqual(
    deviceStatusPresentation({ status: 'pending', approvedAt: '2026-07-29T00:00:00.000Z' }),
    { label: '\u5df2\u6279\u51c6\uff0c\u7b49\u5f85\u65b0\u8bbe\u5907\u5b8c\u6210\u8bbe\u7f6e', color: 'blue' },
    'a reviewed registration must not remain labelled as an unreviewed pending device'
  );
  assert.deepStrictEqual(
    deviceStatusPresentation({ status: 'pending', approvedAt: null }),
    { label: '\u5f85\u5904\u7406', color: 'default' },
    'a device without an approval receipt remains pending'
  );
  assert.deepStrictEqual(
    deviceStatusPresentation({ status: 'active', approvedAt: '2026-07-29T00:00:00.000Z' }),
    { label: '\u53ef\u4fe1', color: 'green' },
    'the completed device exchange is the only state presented as trusted'
  );

  console.log('device status presentation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
