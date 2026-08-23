'use strict';

const assert = require('assert');
const { parsePersonalAssetCsv } = require('./personalAssetCsv');

assert.deepStrictEqual(
  parsePersonalAssetCsv('date,type,amount,category,note\n2026-08-01,income,88.50,Tuition,"August, class"\n2026-08-02,expense,12,Books,\n'),
  [
    { date: '2026-08-01', type: 'income', amount: 88.5, category: 'Tuition', note: 'August, class' },
    { date: '2026-08-02', type: 'expense', amount: 12, category: 'Books', note: '' },
  ],
);
assert.throws(() => parsePersonalAssetCsv('date,type,amount\n2026-08-01,income,1\n'), /PERSONAL_ASSET_CSV_HEADER_INVALID/);
assert.throws(() => parsePersonalAssetCsv('date,type,amount,category,note\n2026-08-01,income,-1,Tuition,\n'), /PERSONAL_ASSET_CSV_ROW_INVALID/);
console.log('personal asset CSV checks passed');
