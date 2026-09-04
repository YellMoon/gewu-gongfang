'use strict';

const MAINLAND_MOBILE = /^1[3-9]\d{9}$/u;
const ALLOWED_INPUT = /^[+0-9\s().\-（）]+$/u;
const SEPARATORS = /[\s().\-（）]/gu;

function normalizeMainlandPhone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !ALLOWED_INPUT.test(value)) return null;
  let compact = value.replace(SEPARATORS, '');
  if (compact.startsWith('+86')) compact = compact.slice(3);
  else if (compact.startsWith('86')) compact = compact.slice(2);
  else if (compact.startsWith('+')) return null;
  return MAINLAND_MOBILE.test(compact) ? compact : null;
}

module.exports = Object.freeze({ normalizeMainlandPhone });
