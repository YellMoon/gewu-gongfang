'use strict';

function sortPaymentsNewestFirst(payments) {
  const timestamp = payment => payment.created_at || payment.payment_date || '';
  return [...payments].sort((a, b) => timestamp(b).localeCompare(timestamp(a)));
}

module.exports = { sortPaymentsNewestFirst };
