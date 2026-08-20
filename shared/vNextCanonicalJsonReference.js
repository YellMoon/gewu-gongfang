'use strict';

function stablePlainObjectJson(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => value[key] !== null && typeof value[key] !== 'string' && typeof value[key] !== 'number')) return null;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`;
}

module.exports = { stablePlainObjectJson };
