'use strict';

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function selectApiBaseUrl({ normalBaseUrl } = {}) {
  return normalizeBaseUrl(normalBaseUrl);
}

module.exports = {
  normalizeBaseUrl,
  selectApiBaseUrl,
};
