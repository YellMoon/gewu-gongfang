'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function csvRows(source) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (char !== '\r') cell += char;
  }
  if (quoted) throw failure('PERSONAL_ASSET_CSV_ROW_INVALID');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(rowValue => rowValue.some(value => String(value).trim()));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parsePersonalAssetCsv(source) {
  if (typeof source !== 'string' || source.length < 1 || source.length > (1024 * 1024)) throw failure('PERSONAL_ASSET_CSV_INPUT_INVALID');
  const rows = csvRows(source.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw failure('PERSONAL_ASSET_CSV_HEADER_INVALID');
  const header = rows[0].map(value => value.trim().toLowerCase());
  if (header.length !== 5 || header.join(',') !== 'date,type,amount,category,note') throw failure('PERSONAL_ASSET_CSV_HEADER_INVALID');
  const records = rows.slice(1);
  if (records.length > 1000) throw failure('PERSONAL_ASSET_CSV_ROW_INVALID');
  return records.map(row => {
    if (row.length !== 5) throw failure('PERSONAL_ASSET_CSV_ROW_INVALID');
    const [date, type, amountText, category, note] = row.map(value => value.trim());
    const amount = Number(amountText);
    if (!validDate(date) || !['income', 'expense'].includes(type) || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100
      || !category || category.length > 128 || note.length > 2000) throw failure('PERSONAL_ASSET_CSV_ROW_INVALID');
    return { date, type, amount, category, note };
  });
}

module.exports = Object.freeze({ parsePersonalAssetCsv });
