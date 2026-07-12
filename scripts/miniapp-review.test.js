const assert = require('assert');
const { buildSubmitAuditPayload, firstCategory, firstPage } = require('./miniapp-review');

const pagePayload = { page_list: ['pages/login/index', 'pages/index/index'] };
const categoryPayload = {
  category_list: [{
    first_class: '教育',
    second_class: '教育信息服务',
    first_id: 100,
    second_id: 101,
  }],
};

assert.strictEqual(firstPage(pagePayload), 'pages/index/index');
assert.deepStrictEqual(firstCategory(categoryPayload), {
  first_class: '教育',
  second_class: '教育信息服务',
  first_id: 100,
  second_id: 101,
});

assert.deepStrictEqual(buildSubmitAuditPayload({ pagePayload, categoryPayload }), {
  item_list: [{
    address: 'pages/index/index',
    tag: '教育,课程,题库',
    title: '格物工坊',
    first_class: '教育',
    second_class: '教育信息服务',
    first_id: 100,
    second_id: 101,
  }],
});

console.log('miniapp review helper checks passed');
