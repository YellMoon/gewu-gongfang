'use strict';

function sortPaymentsNewestFirst(payments) {
  return [...payments].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

module.exports = { sortPaymentsNewestFirst };
