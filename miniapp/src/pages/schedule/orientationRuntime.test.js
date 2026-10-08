'use strict';
// Real Taro compilation and role-scoped two-week navigation, without invented controls.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { harness } = require('./cardContentRuntime.test');
const projection = require('../../utils/cloudBusinessProjection');
const config = fs.readFileSync(path.join(__dirname, 'index.config.ts'), 'utf8');
assert.match(config, /pageOrientation:\s*'auto'/);
const styles = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');
(async () => {
  const sass = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/sass'));
  const postcss = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/postcss'));
  const pxtransform = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/postcss-pxtransform'));
  const compiled = await postcss([pxtransform({ platform: 'weapp', designWidth: 375, deviceRatio: { 375: 2 } })]).process(sass.compileString(styles).css, { from: path.join(__dirname, 'index.scss') });
  const declarations = {};
  compiled.root.walkRules(rule => {
    if (rule.parent.type === 'atrule') return;
    rule.walkDecls(decl => { for (const selector of rule.selector.split(',').map(value => value.trim())) (declarations[selector] ||= {})[decl.prop] = decl.value; });
  });
  const landscape = {};
  compiled.root.walkAtRules('media', media => {
    if (media.params !== '(orientation: landscape)') return;
    media.walkRules(rule => rule.walkDecls(decl => { for (const selector of rule.selector.split(',').map(value => value.trim())) (landscape[selector] ||= {})[decl.prop] = decl.value; }));
  });
  assert.ok(landscape['.calendar-board'], 'real Taro WXSS must retain a landscape rule showing all seven days');
  for (const [selector, property, expected] of [
    ['.calendar-board','width','100%'],['.calendar-board','box-sizing','border-box'],
    ['.week-grid','width','100%'],['.week-grid','gap','4px'],
    ['.day-column','flex','1 1 0'],['.day-column','width','0'],['.day-column','min-width','0'],
    ['.schedule-card','padding','2px 2px'],
  ]) assert.equal(landscape[selector]?.[property]?.toLowerCase(), expected, selector + ' must fit all seven equal columns within the landscape viewport');
  for (const rule of Object.values(landscape)) {
    assert.equal(rule['font-size'], undefined, 'landscape must retain desktop 12px/10px typography');
    assert.equal(rule.height, undefined, 'landscape must retain actual duration geometry');
  }
  for (const [selector, property, expected] of [
    ['.calendar-board','width','1028px'],['.day-column','width','140px'],['.week-grid','gap','8px'],
    ['.schedule-course','font-size','12px'],['.schedule-location-time','font-size','10px'],
    ['.nav-arrow','min-height','44px'],['.nav-today','min-height','44px'],
    ['.schedule-card','padding','2px 4px'],['.schedule-card','border-radius','6px'],
  ]) assert.equal(declarations[selector][property].toLowerCase(), expected, selector + ' must retain actual desktop/fixed-pixel contract through Taro');
  assert.equal(declarations['.week-grid'].display, 'flex');
  assert.equal(declarations['.schedule-course']['white-space'], 'nowrap');
  assert.equal(declarations['.schedule-course']['text-overflow'], 'ellipsis');
  assert.equal(declarations['.schedule-time-range']['white-space'], 'nowrap');
  assert.equal(declarations['.schedule-time-range']['flex-shrink'], '0', 'complete start/end time takes priority over place text');
  assert.equal(declarations['.schedule-place']['min-width'], '0', 'place text may shrink within the seven visible columns');
  assert.equal(declarations['.schedule-place']['text-overflow'], 'ellipsis');
  assert.equal(declarations['.schedule-card']['min-height'], undefined, 'no oversized list-card minimum may override actual duration');
  for (const selector of ['.schedule-card','.schedule-body']) {
    assert.equal(declarations[selector]['align-items'], 'center');
    assert.equal(declarations[selector]['justify-content'], 'center');
  }
  assert.equal(declarations['.holiday .day-section-title'].background, '#f5222d');
  assert.equal(declarations['.day-column.today']['border-color'], '#1890ff');
  assert.equal(declarations['.week-view.week-view']['overflow-x'], 'auto');
  assert.equal(declarations['.week-view.week-view']['overflow-y'], 'auto');
  assert.equal(declarations['.schedule-page'].height, '100vh', 'native page height must remain its actual window height');
  assert.equal(declarations['.taro_tabbar_page .schedule-page'].height.toLowerCase(), 'calc(100vh - var(--tabbar-height, 50px))', 'only H5 reserves its HTML tab bar');
  const { JSDOM } = require('jsdom');
  const taroCss = fs.readFileSync(require.resolve('@tarojs/components-react/dist/index.css', { paths: [path.resolve(__dirname, '../../..')] }), 'utf8');
  // JSDOM's sheet cascade does not implement cross-sheet specificity; verify the
  // actual selector weights independently, then compute the composed real CSS.
  const selectorParser = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/postcss-selector-parser'));
  const classWeight = selector => { let count = 0; selectorParser(selectors => selectors.walkClasses(() => count++)).processSync(selector); return count; };
  const taroRules = postcss.parse(taroCss);
  taroRules.walkRules(rule => { if (rule.selector === '.taro-scroll-view__scroll-y') assert.ok(classWeight('.week-view.week-view') > classWeight(rule.selector), 'explicit board axes must win even if Taro CSS is injected later'); });
  const window = new JSDOM(`<style>${taroCss}</style><style>${sass.compileString(styles).css}</style><div class="week-view taro-scroll taro-scroll-view__scroll-x taro-scroll-view__scroll-y"></div>`).window;
  const overflow = window.getComputedStyle(window.document.querySelector('.week-view'));
  assert.equal(overflow.overflowX, 'auto', 'real Taro scroll-y default must not disable reaching the last day horizontally');
  assert.equal(overflow.overflowY, 'auto', 'both actual H5 scroll axes must remain usable');
  window.close();
  const today = projection.shanghaiDateKey(new Date()), nextWeek = projection.shiftShanghaiDateKey(today, 7);
  const lessons = [
    { id:'own',course_id:'a',course_name:'物理',start_time:today+'T08:05:00',end_time:today+'T09:35:00',status:1,student_ids:['a'] },
    { id:'other',course_id:'b',course_name:'数学',start_time:today+'T09:40:00',end_time:today+'T10:40:00',status:1,student_ids:['b'] },
    { id:'next',course_id:'a',course_name:'物理',start_time:nextWeek+'T10:00:00',end_time:nextWeek+'T11:00:00',status:1,student_ids:['a'] },
  ];
  for (const role of ['super_admin','teacher','student','family_member']) {
    const scoped = ['student','family_member'].includes(role);
    const data = { schedules: scoped ? lessons.filter(item => item.student_ids.includes('a')) : lessons, courses:[],rooms:[],students:[{id:'technical-id',name:'验收学生'}] };
    const h=harness(role,data); await h.mount();
    assert.equal(h.find('week-grid').length,2);
    assert.equal(h.find('day-column').length,14);
    assert.equal(h.find('schedule-card').length,scoped?2:3,'cloud role scope must remain unchanged');
    for (const cls of ['filter-bar','filter-tag','toggle-btn','nav-title','day-section-count']) assert.equal(h.find(cls).length,0,cls+' is not part of the requested desktop board');
    assert.equal(h.find('nav-arrow').length,2); assert.equal(h.find('nav-today').length,1);
    h.find('nav-arrow')[1].props.onClick();
    assert.equal(h.find('schedule-card').length,1,'next-week navigation moves both week rows together');
    assert.equal(h.find('day-column')[0].props['data-date'],projection.shanghaiWeekDateKeys(nextWeek)[0]);
    h.find('nav-today')[0].props.onClick();
    assert.equal(h.find('schedule-card').length,scoped?2:3);
    assert.equal(h.find('week-view')[0].props.scrollY,true);
    assert.equal(h.find('week-view')[0].props.scrollX,true);
    assert.equal(h.find('week-view')[0].props.enableFlex,true);
  }
  const visitor=harness('visitor',{schedules:lessons,courses:[],students:[],rooms:[]}); await visitor.mount();
  assert.equal(visitor.find('schedule-card').length,0);
  console.log('actual Taro landscape full seven columns/portrait fixed 140px two-week grid/readable desktop typography/compact toolbar/role-scoped navigation/scroll/rotation checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

