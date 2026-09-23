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
for (const amount of ['2.55', '18.35', '0.01', '100000000']) {
  assert.equal(parsePersonalAssetCsv(`date,type,amount,category,note\n2026-09-23,expense,${amount},Books,`)[0].amount, Number(amount));
}
for (const amount of ['100000000.01', '1.001', '0.00000000001', 'NaN']) {
  assert.throws(() => parsePersonalAssetCsv(`date,type,amount,category,note\n2026-09-23,expense,${amount},Books,`), /PERSONAL_ASSET_CSV_ROW_INVALID/);
}
const {personalAssetImportKey}=require('./personalAssetImport');
const sample='date,type,amount,category,note\n2026-09-23,expense,2.55,Books,';
assert.equal(personalAssetImportKey(parsePersonalAssetCsv(sample)),personalAssetImportKey(parsePersonalAssetCsv('\uFEFF'+sample.replace(/\n/g,'\r\n'))));
assert.notEqual(personalAssetImportKey(parsePersonalAssetCsv(sample)),personalAssetImportKey(parsePersonalAssetCsv(sample.replace('2.55','2.56'))));
console.log('personal asset CSV, cent precision and stable retry key checks passed');
