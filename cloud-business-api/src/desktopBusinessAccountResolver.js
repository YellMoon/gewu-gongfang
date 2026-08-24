'use strict';

function selectDesktopBusinessAccount({ directAccount, phoneAccount }) {
  return phoneAccount || directAccount || null;
}

module.exports = Object.freeze({ selectDesktopBusinessAccount });
