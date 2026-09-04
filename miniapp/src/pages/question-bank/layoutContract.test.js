'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, 'index.config.ts'), 'utf8');
const paperSource = fs.readFileSync(path.join(__dirname, '..', 'question-paper', 'index.tsx'), 'utf8');
const overlaySource = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'QuestionBasketOverlay.tsx'), 'utf8');
const overlayStyles = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'QuestionBasketOverlay.scss'), 'utf8');
const tabBarStyles = fs.readFileSync(path.join(__dirname, '..', '..', 'custom-tab-bar', 'index.scss'), 'utf8');

assert.doesNotMatch(source, /className='page-title'/, 'the native navigation title must not be repeated inside the page');
assert.doesNotMatch(source, /className='preview-title'/, 'the question list must not add a meaningless second heading');
assert.doesNotMatch(source, /className='preview-refresh'/, 'miniapp refresh must use the native pull gesture rather than permanent page chrome');
assert.doesNotMatch(source, /搜索题目、来源或知识点/, 'question text, source and knowledge filters must not be collapsed into one field');
assert.match(source, /placeholder='搜索题干、题号或选项'/, 'the text search must describe only the fields it searches');
assert.match(source, /<Picker[\s\S]*selectedSubject/, 'subject must be an explicit primary search scope');
assert.match(source, /selectedType/, 'question type must have its own filter');
assert.match(source, /selectedSource/, 'source must have its own filter');
assert.match(source, /selectedKnowledge/, 'knowledge point must have its own filter');
assert.match(source, /selectedDifficulty/, 'difficulty must remain an independent filter like the desktop question bank');
assert.match(source, /selectedGrade/, 'grade must remain available in the mobile version of the desktop filter set');
assert.match(source, /selectedSemester/, 'semester must remain available in the mobile version of the desktop filter set');
assert.match(source, /selectedExamType/, 'exam type must remain available in the mobile version of the desktop filter set');
assert.match(source, /selectedExamYear/, 'exam year must remain available in the mobile version of the desktop filter set');
assert.match(source, /className='question-source-input'/, 'source needs a dedicated text field because it searches source, region, school and year');
assert.match(source, /placeholder='来源、地区、学校或年份'/, 'the source field must describe its own search boundary');
assert.match(source, /className='question-filter-cell question-filter-knowledge'/, 'knowledge points need their own mobile filter control');
assert.match(source, /className='question-filter-cell question-filter-type'[\s\S]*?range=\{\['全部题型'/, 'the type filter must occupy its own grid area');
assert.match(source, /className='question-filter-cell question-filter-knowledge'[\s\S]*?range=\{\['全部知识点'/, 'the knowledge filter must occupy its own grid area');
assert.match(source, /className='question-filter-cell question-filter-difficulty'[\s\S]*?difficultyValues/, 'the difficulty filter must occupy its own grid area');
for (const [field, label] of [['grade', '\u5e74\u7ea7'], ['semester', '\u5b66\u671f'], ['exam-type', '\u8003\u8bd5\u7c7b\u578b'], ['exam-year', '\u5b66\u5e74']]) {
  assert.match(source, new RegExp(`className='question-filter-cell question-filter-${field}'`), `${label} must have its own secondary control`);
  assert.match(source, new RegExp(`question-more-filter-field-label[^>]*>\\{'${label}'\\}`), `${label} must keep its own visible field label`);
}
assert.doesNotMatch(source, /function questionSearchText/, 'question text search must not filter only the currently loaded page');
for (const field of ['subject', 'query', 'source', 'knowledgePoint', 'type', 'difficulty', 'grade', 'semester', 'examType', 'examYear']) {
  assert.match(source, new RegExp(`${field}:`), `question browsing must send ${field} to the cloud filter contract`);
}
assert.match(source, /setQuestionTotal\(response\.data\?\.total/, 'the result summary must use the authoritative filtered total');
assert.doesNotMatch(source, /<ScrollView[^>]*className='question-preview-list'/, 'the question list must use native page scrolling instead of a clipped nested scroller');
assert.match(source, /usePullDownRefresh/, 'the question list must support the native miniapp pull-to-refresh gesture');
assert.match(source, /Taro\.stopPullDownRefresh\(\)/, 'the native refresh gesture must always be stopped after loading');
assert.match(source, /useReachBottom/, 'visitor continuation checks must follow native page scrolling');
assert.match(config, /enablePullDownRefresh:\s*true/, 'the page configuration must enable native pull-to-refresh');
assert.match(source, /<QuestionBasketOverlay/, 'the question bank must mount the shared global basket');
assert.match(paperSource, /<QuestionBasketOverlay/, 'the paper editor must mount the same shared global basket');
assert.doesNotMatch(source, /className='question-basket-float'/, 'the page must not retain a private basket button');
assert.match(source, /className='question-card-index'/, 'every rendered question must keep an explicit visible number');
const cardBlock = source.match(/visibleQuestions\.map\(\(\{ question(?:: rawQuestion)?, display \}, index\) => \{([\s\S]*?)\n\s*\}\)\}/);
assert.ok(cardBlock, 'question card rendering must remain an explicit contract');
assert.doesNotMatch(cardBlock[1], /question\.subject/, 'the page-level subject scope must not be repeated on every question card');
assert.match(source, /function questionSourceLabel\(question: QuestionPreview\)/, 'source display must use one explicit desktop-compatible composition boundary');
assert.match(source, /question\.sourceLabel/, 'the page must prefer the authoritative composed source label when cloud provides one');
for (const field of ['source', 'region', 'school', 'examType', 'examYear']) {
  assert.match(source, new RegExp(`question\\.${field}`), `source display must retain the ${field} fallback component`);
}
assert.match(cardBlock[1], /questionSourceLabel\((?:rawQuestion|question)\)/, 'question cards must render the composed source instead of dropping source metadata');
assert.match(source, /className='question-option-label'/, 'option letters and punctuation must be rendered independently from option content');
assert.match(source, /columnsForOptions/, 'option layout must inherit the desktop column rules');
assert.match(source, /inBasket \? '移出试题篮' : '加入试题篮'/, 'every question must expose the basket action and its selected state');
assert.doesNotMatch(source, /canBuildPaper \? <Button className='basket-toggle'/, 'restricted roles should receive an explanation after tapping, not lose the action entirely');
assert.match(source, /hasQuestionAnswerContent\(display\)/, 'the answer action must follow the desktop rule and appear only when answer content exists');
assert.match(source, /hasAnswerContent \? <Button[\s\S]*?className='question-answer-toggle'/, 'an empty answer must not create a meaningless expansion button');
assert.doesNotMatch(styles, /\.question-preview-list\s*\{[^}]*max-height/s, 'the question list must not leave a fixed blank region above the tab bar');
assert.match(overlayStyles, /\.global-question-basket\s*\{[^}]*position:\s*fixed/s, 'the shared basket must float independently of page layout');
assert.match(styles, /\.question-subject-picker[\s\S]*?min-height:\s*104rpx/s, 'the primary subject picker must keep a usable touch target on narrow devices');
assert.match(styles, /\.question-answer-toggle,[\s\S]*?\.basket-toggle\s*\{[\s\S]*?min-height:\s*104rpx/s, 'question actions must keep a usable touch target on narrow devices');
assert.match(overlayStyles, /\.global-question-basket\s*\{[\s\S]*?height:\s*104rpx/s, 'the global basket must keep a usable touch target on narrow devices');
assert.match(overlaySource, /className='question-basket-drawer'/, 'the floating basket must open a real shared drawer');
assert.match(overlaySource, /<PageContainer[\s\S]*?closeOnSlideDown/, 'the basket drawer must close before the page on native back and slide-down gestures');
assert.match(overlaySource, /questionBasketStore\.move/, 'the shared basket drawer must support ordering');
assert.match(overlaySource, /questionBasketStore\.removeMany/, 'the shared basket drawer must support single and bulk removal');
assert.match(overlaySource, /questionBasketStore\.clear/, 'the shared basket drawer must support confirmed clearing');
assert.match(overlaySource, /questionBasketStore\.beginPaper/, 'the shared basket drawer must pass the selected subset to the editor');
assert.match(overlaySource, /if \(onBeginPaper\) onBeginPaper/, 'the paper page must be able to apply a new basket selection without stacking the same route');
assert.match(overlaySource, /basket\.questionRevision/, 'late or replaced cloud question metadata must refresh basket statistics');
assert.match(overlaySource, /disabled=\{!question\}/, 'an unavailable basket item must not remain selectable for paper composition');
assert.match(overlaySource, /persistence-failed/, 'basket actions must explain durable storage failures instead of pretending the selection is empty');
assert.doesNotMatch(styles, /252rpx/, 'the retired oversized basket spacer must not leave a blank region above the tab bar');
const bankBottomPadding = Number(styles.match(/\.question-bank-page\s*\{[\s\S]*?padding:[^;]*calc\((\d+)rpx \+ env\(safe-area-inset-bottom\)\)/)?.[1] || 0);
const basketBottom = Number(overlayStyles.match(/&\.above-tab-bar\s*\{\s*bottom:\s*calc\((\d+)rpx \+ env\(safe-area-inset-bottom\)\)/)?.[1] || 0);
const basketHeight = Number(overlayStyles.match(/\.global-question-basket\s*\{[\s\S]*?height:\s*(\d+)rpx/)?.[1] || 0);
const cardBottomInset = Number(styles.match(/\.question-preview-item,[\s\S]*?padding:\s*\d+rpx\s+\d+rpx\s+(\d+)rpx/)?.[1] || 0);
assert.ok(bankBottomPadding > 0 && basketBottom > 0 && basketHeight > 0 && cardBottomInset > 0, 'basket clearance values must remain statically measurable');
assert.ok(bankBottomPadding + cardBottomInset >= basketBottom + basketHeight + 8, `the last question action must clear the floating basket by at least 8rpx (${bankBottomPadding} + ${cardBottomInset} vs ${basketBottom} + ${basketHeight})`);
assert.match(source, /question-more-filter-layer/, 'secondary desktop filters must use a mobile bottom sheet instead of occupying half the screen');
assert.match(source, /<ScrollView\s+className='[^']*question-more-filter-scroll[^']*'\s+scrollY/, 'the tall more-filter form must use a native scroll container');
assert.match(source, /question-active-filters/, 'active secondary filters must stay visible and individually clearable');
assert.match(styles, /grid-template-columns:\s*repeat\(3,[\s\S]*?grid-template-areas:\s*'type difficulty more'/, 'the idle filter panel must keep type, difficulty and more filters on one compact row');
assert.match(styles, /\.question-source-input\s*\{[\s\S]*?min-height:\s*104rpx/s, 'the source text field must keep a full mobile touch target');
const filterLayerZ = Number(styles.match(/\.question-more-filter-layer\.open\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1] || 0);
const tabBarZ = Number(tabBarStyles.match(/\.role-tabbar\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1] || 0);
assert.ok(filterLayerZ > tabBarZ, `the more-filter sheet (${filterLayerZ}) must cover and block the custom tab bar (${tabBarZ})`);
const filterLayerBottom = Number(styles.match(/\.question-more-filter-layer\.open\s*\{[\s\S]*?bottom:\s*calc\((\d+)rpx \+ env\(safe-area-inset-bottom\)\)/)?.[1] || 0);
const tabBarHeight = Number(tabBarStyles.match(/\.role-tabbar\s*\{[\s\S]*?min-height:\s*(\d+)rpx/)?.[1] || 0);
assert.ok(filterLayerBottom >= tabBarHeight, `the more-filter sheet must stay above the native custom-tab-bar layer (${filterLayerBottom} vs ${tabBarHeight})`);
assert.match(styles, /\.question-more-filter-scroll\s*\{[\s\S]*?flex:\s*1[\s\S]*?min-height:\s*0/s, 'the native filter scroller must consume the remaining sheet height without being clipped');
assert.match(source, /className=\{'question-more-filter-layer '[\s\S]*?catchMove=\{moreFiltersOpen\}/, 'the open filter layer must consume touch-move gestures instead of leaking them to the page or custom tab bar');

console.log('miniapp question bank layout contract checks passed');
