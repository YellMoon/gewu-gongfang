'use strict';
// UTF-8: Import actions remain explicit; identical parsed content safely retries.
const sha256 = require('crypto-js/sha256');
function personalAssetImportKey(records) {
  const canonical = records.map(({date, type, amount, category, note}) => ({date, type, amount, category, note}));
  return 'asset-import-' + sha256(JSON.stringify(canonical)).toString();
}
function personalAssetImportError(error) {
  const code = String(error?.code || error?.message || '');
  if (code === 'PERSONAL_ASSET_CSV_HEADER_INVALID') return 'CSV 表头应为 date,type,amount,category,note';
  if (code === 'PERSONAL_ASSET_CSV_ROW_INVALID') return '请检查日期、收支类型、金额和分类，最多导入 1000 条';
  if (code === 'PERSONAL_ASSET_CSV_INPUT_INVALID') return '请选择非空 CSV 文件，大小不超过 1 MB';
  if (code === 'CSV_FILE_REQUIRED') return '请选择 CSV 文件';
  if (/ACCESS_DENIED|FORBIDDEN/.test(code)) return '当前账号不能导入，请在“我的”中查看角色';
  return '未能确认导入结果，请重试同一文件，不会重复添加';
}
module.exports = { personalAssetImportKey, personalAssetImportError };
