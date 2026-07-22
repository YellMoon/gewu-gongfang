'use strict';

function cleanLabel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getMiniappHomeDisplayName(identity) {
  return cleanLabel(identity?.name)
    || cleanLabel(identity?.nickname)
    || '\u5fae\u4fe1\u7528\u6237';
}

module.exports = { getMiniappHomeDisplayName };
