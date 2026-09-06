'use strict';

// Browsing and every media-delivery operation must use the same ordered scope.
module.exports = Object.freeze({
  MINIAPP_VISITOR_QUESTION_LIMIT: 20,
  MINIAPP_QUESTION_ORDER_SQL: 'c.updated_at DESC,q.id ASC',
});
