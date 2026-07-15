'use strict';

const REVIEW_LOGIN_PATH = '/api/auth/review-demo';

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function selectApiBaseUrl({ path, normalBaseUrl, reviewBaseUrl, isReviewIdentity = false } = {}) {
  const pathname = String(path || '').split('?')[0];
  const useReviewGateway = pathname === REVIEW_LOGIN_PATH || isReviewIdentity === true;
  return normalizeBaseUrl(useReviewGateway ? reviewBaseUrl : normalBaseUrl);
}

module.exports = {
  REVIEW_LOGIN_PATH,
  normalizeBaseUrl,
  selectApiBaseUrl,
};
