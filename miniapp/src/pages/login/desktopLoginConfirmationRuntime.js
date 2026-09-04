'use strict';

function strictText(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function parseDesktopLoginConfirmationQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  const scene = strictText(query.scene, 32);
  return scene && /^d_[A-Za-z0-9_-]{30}$/u.test(scene) ? Object.freeze({ scene }) : null;
}

function desktopLoginConfirmationError(code) {
  if (code === 'CLOUD_DESKTOP_PAIRING_REJECTED') return '登录二维码已失效，请在电脑上重新获取';
  return '暂时无法连接，请稍后重试';
}

module.exports = Object.freeze({ parseDesktopLoginConfirmationQuery, desktopLoginConfirmationError });
