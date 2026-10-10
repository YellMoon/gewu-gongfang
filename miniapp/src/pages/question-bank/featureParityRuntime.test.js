'use strict';
// UTF-8: Execute the real page with deterministic cloud replies, never production data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { richPhysicsQuestions } = require(path.resolve(__dirname, '../../../../scripts/capture-miniapp-ui-matrix.js'));
const authorization = require('../../utils/miniappAuthorizationRuntime');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const tick = () => new Promise(resolve => setImmediate(resolve));
function page(role = 'teacher') {
  let identity = { id: 'first-' + role, role, user_type: role }, generation = 0, cursor = 0, bottom, show;
  const state = [], effectSlots = [], pendingEffects = [], timers = new Map(), calls = [], basket = [], assets = [], modals = [], routes = [];
  let timerId = 0, responseOverride = null;
  const filters = { subjects: ['physics', 'mathematics'], types: ['single_choice', 'multiple_choice'], sources: [], knowledgePoints: ['动力学'], difficulties: [1, 2, 3], grades: ['高一'], semesters: ['上学期'], examTypes: ['期中'], examYears: ['2026'] };
  const slot = value => { const i = cursor++; if (!(i in state)) state[i] = value; return i; };
  const jsx = (type, props) => ({ type, props: props || {} });
  const deps = {
    '../../../../shared/questionDifficulty': require('../../../../shared/questionDifficulty'),
    react: {
      useState: initial => { const i = slot(typeof initial === 'function' ? initial() : initial); return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useRef: initial => state[slot({ current: initial })], useMemo: fn => fn(),
      useEffect: (fn, dependencies) => {
        const i = slot(null), previous = effectSlots[i];
        if (!previous || !dependencies || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
          if (previous?.cleanup) previous.cleanup();
          const record = { dependencies, cleanup: null }; effectSlots[i] = record;
          pendingEffects.push(() => { record.cleanup = fn(); });
        }
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@tarojs/components': Object.fromEntries(['View', 'Text', 'Input', 'Button', 'Picker', 'RichText', 'ScrollView'].map(name => [name, name])),
    '@tarojs/taro': { default: { getStorageSync: () => identity, showToast: () => {}, stopPullDownRefresh: () => {}, showModal: value => modals.push(value), navigateTo: value => routes.push(value.url) }, useDidShow: fn => { show = fn; }, usePullDownRefresh: () => {}, useReachBottom: fn => { bottom = fn; } },
    '../../utils/api': { miniappCloudBusinessApi: { listQuestionPreviews: async (token, options) => {
      calls.push({ token, options });
      if (responseOverride) return responseOverride(token, options);
      return { success: true, data: { questions: options.cursor ? [richPhysicsQuestions[1], richPhysicsQuestions[2]] : richPhysicsQuestions.slice(0, 2), total: 4, filterOptions: filters, hasMore: !options.cursor, nextCursor: options.cursor ? null : 'opaque-next' } };
    }, listQuestionPreviewsByIds: async () => ({ success: true, data: { questions: richPhysicsQuestions, unavailableIds: [] } }) } },
    '../../utils/questionAssetDelivery': { loadQuestionAsset: async value => { assets.push(value); return '/fixture/' + value.assetKey + '.png'; } },
    '../../utils/authSession': { authSessionRuntime: { capture: () => ({ identity, token: identity.id, generation }), isSameSession: session => session.generation === generation } },
    '../../utils/miniappAuthorizationRuntime': authorization,
    '../../utils/questionBasketStore': { questionBasketStore: { reconcileIdentity: () => {}, seedQuestions: () => {}, snapshot: () => ({ scopeKey: ['super_admin', 'teacher'].includes(identity.role) ? identity.id : null }), toggle: id => { basket.includes(id) ? basket.splice(basket.indexOf(id), 1) : basket.push(id); return { written: true }; } }, useQuestionBasket: () => ({ ids: basket.slice() }) },
    '../../components/QuestionBasketOverlay': { default: 'Basket' }, '../../utils/questionDisplay': require('../../utils/questionDisplay'), './questionTypography': require('./questionTypography'), './index.scss': {},
  };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', js)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, m, m.exports, fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
  const render = () => { cursor = 0; return m.exports.default(); };
  const h = { calls, assets, modals, routes, basket, render, bottom: () => bottom(), show: () => show(), swapIdentity: role => { generation++; identity = { id: 'second-' + role, role, user_type: role }; }, response: value => { responseOverride = value; } };
  h.find = cls => nodes(render()).filter(node => (node.props.className || '').split(' ').includes(cls));
  h.flush = async () => {
    for (let i = 0; i < 12; i++) {
      render(); pendingEffects.splice(0).forEach(fn => fn());
      const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
      await tick();
      if (!pendingEffects.length && !timers.size) { render(); if (!pendingEffects.length && !timers.size) return; }
    }
    throw Error('page fixture did not settle');
  };
  return h;
}
(async () => {
  const h = page(); await h.flush();
  assert.match(h.find('question-option-content')[0].props.nodes, /0\u00a0N/, 'the actual option sent to RichText must keep the numeric value and unit together');
  assert.equal(h.calls.at(-1).options.subject, 'physics');
  for (const [className, field, expected] of [
    ['question-filter-type', 'type', 'single_choice'], ['question-filter-knowledge', 'knowledgePoint', '动力学'],
    ['question-filter-difficulty', 'difficulty', 1], ['question-filter-grade', 'grade', '高一'],
    ['question-filter-semester', 'semester', '上学期'], ['question-filter-exam-type', 'examType', '期中'],
    ['question-filter-exam-year', 'examYear', '2026'],
  ]) {
    h.find(className)[0].props.onChange({ detail: { value: 1 } }); await h.flush();
    assert.equal(h.calls.at(-1).options[field], expected, field + ' must be sent to the cloud authority from the actual picker');
  }
  h.find('question-search-input')[0].props.onInput({ detail: { value: '  速度  ' } });
  h.find('question-source-input')[0].props.onInput({ detail: { value: '格物工坊' } }); await h.flush();
  assert.equal(h.calls.at(-1).options.query, '速度'); assert.equal(h.calls.at(-1).options.source, '格物工坊');
  assert.match(text(h.find('question-list-summary')[0]), /共 4 题/);
  const before = h.calls.length; h.bottom(); await h.flush();
  assert.equal(h.calls.length, before + 1); assert.equal(h.calls.at(-1).options.cursor, 'opaque-next');
  assert.equal(h.find('question-preview-item').length, 3, 'incremental page must merge IDs without losing prior rows or duplicating overlap');
  const after = h.calls.length; h.bottom(); await h.flush(); assert.equal(h.calls.length, after, 'terminal cursor must stop requests');
  const picker = nodes(h.render()).find(node => node.type === 'Picker' && node.props.range?.includes('数学'));
  picker.props.onChange({ detail: { value: 1 } }); await h.flush();
  assert.equal(h.calls.at(-1).options.subject, 'mathematics');
  for (const field of ['type', 'source', 'knowledgePoint', 'difficulty', 'grade', 'semester', 'examType', 'examYear']) assert.equal(h.calls.at(-1).options[field], undefined, 'subject switch resets ' + field);
  h.find('basket-toggle')[0].props.onClick({ stopPropagation() {} }); assert.equal(h.basket.length, 1);
  h.find('basket-toggle')[0].props.onClick({ stopPropagation() {} }); assert.equal(h.basket.length, 0);
  h.find('question-answer-toggle')[0].props.onClick({ stopPropagation() {} }); await h.flush();
  assert.ok(h.find('question-answer-content').length);
  assert.ok(nodes(h.render()).some(node => node.type === 'RichText' && typeof node.props.nodes === 'string'));

  const assetKey = 'a'.repeat(64);
  const structured = JSON.parse(JSON.stringify(richPhysicsQuestions[3]));
  structured.richContent.sections.stem.content[0].content.push({ type: 'image', attrs: { assetKey, alt: '小车示意图' } });
  const media = page();
  media.response(async () => ({ success: true, data: { questions: [structured], total: 1, filterOptions: filtersForMedia(), hasMore: false } }));
  await media.flush();
  assert.equal(media.find('question-subquestion').length, 2, 'actual question cards must expose structured small questions');
  media.find('question-preview-item')[0].props.onClick(); await media.flush();
  assert.ok(media.assets.some(request => request.questionId === structured.id && request.assetKey === assetKey), 'the card must request media under its authoritative question and asset IDs');
  assert.match(media.find('question-preview-stem')[0].props.nodes, new RegExp('/fixture/' + assetKey + '\\.png'), 'RichText must receive the delivered image path');
  assert.match(media.find('question-preview-stem')[0].props.nodes, /v<sub>0<\/sub>/);
  media.find('question-answer-toggle')[0].props.onClick({ stopPropagation() {} }); await media.flush();
  assert.equal(media.find('question-subquestion-answer').length, 2);
  const answerNodes = media.find('question-answer-content').map(node => node.props.nodes).join('');
  assert.match(answerNodes, /question-formula-fraction/);
  assert.match(answerNodes, /t<sup>2<\/sup>/);
  assert.match(answerNodes, /牛顿第二定律/);

  for (const role of ['student', 'family_member', 'visitor']) {
    const readOnly = page(role); await readOnly.flush();
    readOnly.find('basket-toggle')[0].props.onClick({ stopPropagation() {} });
    assert.equal(readOnly.basket.length, 0, role + ' must not write a basket or export task');
    assert.equal(readOnly.modals.at(-1).title, '组卷需要教师角色');
    assert.equal(nodes(readOnly.render()).find(node => node.type === 'Basket').props.canUse, false);
  }

  // A tab can survive logout/login: its previous cloud rows must not survive the new session.
  const switched = page('teacher'); await switched.flush();
  const previousCalls = switched.calls.length;
  switched.response(async () => ({ success: true, data: { questions: [], total: 0, filterOptions: { subjects: [], types: [], sources: [], knowledgePoints: [], difficulties: [] }, hasMore: false } }));
  switched.swapIdentity('student'); switched.show(); await switched.flush();
  assert.ok(switched.calls.length > previousCalls, 'a did-show under a new session must re-read questions from that session');
  assert.equal(switched.calls.at(-1).token, 'second-student');
  assert.equal(switched.find('question-preview-item').length, 0, 'new session must not retain old account question cards');
  assert.equal(text(switched.find('question-empty-title')[0]), '题库中暂无题目', 'previous account filters must not turn the new empty library into a filter miss');
  console.log('question actual page filters/pagination/rich text/basket/readonly role/session refresh parity passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

function filtersForMedia() { return { subjects: ['physics'], types: ['solution'], sources: [], knowledgePoints: [], difficulties: [], grades: [], semesters: [], examTypes: [], examYears: [] }; }
