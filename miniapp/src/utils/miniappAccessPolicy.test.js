const assert = require('assert');
const fs = require('fs');
require('./miniappAuthorizationRuntime.test');
require('./miniappAuthorizationSession.test');
require('./miniappPermissionFetchRuntime.test');
require('../pages/admin/users/adminReviewCoordinator.test');

const permission = fs.readFileSync('miniapp/src/utils/permission.ts', 'utf-8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const cloudRelayRoute = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const gatewayApp = fs.readFileSync('gateway/src/app.js', 'utf-8');
const miniappHome = fs.readFileSync('miniapp/src/pages/index/index.tsx', 'utf-8');
const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf-8');
const questionBankPage = fs.readFileSync('miniapp/src/pages/question-bank/index.tsx', 'utf-8');
const assetsPage = fs.readFileSync('miniapp/src/pages/assets/index.tsx', 'utf-8');
const assetsStyles = fs.readFileSync('miniapp/src/pages/assets/index.scss', 'utf-8');
const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const storageSource = fs.readFileSync('miniapp/src/utils/storage.ts', 'utf-8');
const syncSource = fs.readFileSync('miniapp/src/utils/sync.ts', 'utf-8');
const adminUsersPage = fs.readFileSync('miniapp/src/pages/admin/users/index.tsx', 'utf-8');
const studentsPage = fs.readFileSync('miniapp/src/pages/students/index.tsx', 'utf-8');
const teachersPage = fs.readFileSync('miniapp/src/pages/teachers/index.tsx', 'utf-8');
const teachersStyles = fs.readFileSync('miniapp/src/pages/teachers/index.scss', 'utf-8');
const paymentsPage = fs.readFileSync('miniapp/src/pages/payments/index.tsx', 'utf-8');
const schedulePage = fs.readFileSync('miniapp/src/pages/schedule/index.tsx', 'utf-8');
const scheduleDetailPage = fs.readFileSync('miniapp/src/pages/schedule/detail/index.tsx', 'utf-8');
const scheduleStyles = fs.readFileSync('miniapp/src/pages/schedule/index.scss', 'utf-8');
const sharedComponents = fs.readFileSync('miniapp/src/components/shared.tsx', 'utf-8');
const coursesPage = fs.readFileSync('miniapp/src/pages/courses/index.tsx', 'utf-8');
const paymentsPageSource = fs.readFileSync('miniapp/src/pages/payments/index.tsx', 'utf-8');
const customTabBar = fs.readFileSync('miniapp/src/custom-tab-bar/index.tsx', 'utf-8');

assert.ok(permission.includes('readonlyModules'), 'miniapp permission should define readonlyModules');
assert.ok(permission.includes('allowedWriteTasks'), 'miniapp permission should define allowedWriteTasks');
assert.ok(permission.includes('studentModules'), 'miniapp permission should define studentModules');
assert.ok(permission.includes('getMiniappRolePolicy'), 'miniapp permission should expose role-specific policy');
assert.ok(permission.includes('accountExperiencePolicy(user)') && permission.includes('canUserSubmitMiniappWrite'), 'miniapp permission boundary must delegate the real account experience policy and generic write checks to the tested runtime');
assert.ok(permission.includes('createPermissionFetchBoundary') && permission.includes('sanitizeCapabilities: sanitizeCapabilitiesForIdentity'), 'fetchPermissions and persistent session cache must use the behavior-tested sanitizer boundary');
assert.ok(
  permission.includes("'super_admin' | 'admin' | 'teacher' | 'student' | 'visitor' | 'pending'"),
  'miniapp user contract should include every unified authorization role',
);
for (const scopeField of ['tenant_id?: string', 'tenantId?: string', 'teacher_id?: string', 'teacherId?: string', 'active?: number | boolean', 'deleted?: number | boolean', 'disabled?: number | boolean']) {
  assert.ok(permission.includes(scopeField), `miniapp user contract must retain the verified normal-scope field ${scopeField}`);
}
assert.ok(
  !permission.includes("user.user_type === 'student' ? user.id : undefined"),
  'the account user id must never be treated as a fallback student profile id',
);
assert.ok(permission.includes("'users:review'"), 'super admin policy should expose the review capability');
assert.ok(permission.includes("'business:all'"), 'administrator policy should consume the shared business capability');
assert.ok(permission.includes("'business:teacher-scope'"), 'teacher policy should consume the shared teacher scope capability');
assert.ok(permission.includes("'question-bank:edit'"), 'teacher policy should expose shared question-bank editing');
assert.ok(!permission.includes("'question-bank:delete-committed'"), 'miniapp must never expose committed question deletion');
assert.ok(permission.includes("role: 'super_admin'"), 'miniapp should distinguish the fixed super administrator');
assert.ok(permission.includes("role: 'teacher'"), 'miniapp should expose the teacher role policy');
assert.ok(permission.includes("readonlyScope: 'teacher'"), 'teacher policy should use teacher-owned data scope');
assert.ok(permission.includes("role: 'pending'"), 'pending users should resolve to an explicit no-access policy');
assert.ok(permission.includes('capabilities:'), 'role policy should surface backend-compatible capability names');
assert.ok(permission.includes('isStudentUser'), 'miniapp permission should distinguish student users');
assert.ok(permission.includes('getLinkedStudentIds'), 'miniapp permission should expose linked student ids');
assert.ok(api.includes('createMiniappTask'), 'miniapp API should create allowed cloud tasks');
assert.ok(api.includes('authorityProjectionApi'), 'miniapp API should expose the authority projection facade');
assert.ok(
  miniappHome.includes('pullFromCloudBusinessProjection()') && !miniappHome.includes("readCloudSnapshot('full')"),
  'miniapp home must read the cloud business projection instead of the legacy cloud snapshot path',
);
assert.ok(
  miniappHome.includes("console.warn('[CLOUD_BUSINESS_PROJECTION_LOAD_FAILED]', error)"),
  'miniapp home must keep cloud business projection load failures observable',
);
assert.ok(api.includes('readQuestionPreview'), 'miniapp must consume the answer-free question preview contract');
assert.ok(
  questionBankPage.includes('if (useLimitedProjection)')
    && questionBankPage.includes('miniappCloudBusinessApi.listQuestionPreviews')
    && !questionBankPage.includes('if (isVisitor) {'),
  'visitor and unbound formal accounts must share the cloud limited-preview surface without paper task controls',
);
assert.ok(
  miniappHome.includes('usesLimitedQuestionProjection')
    && miniappHome.includes('limitedSubject')
    && miniappHome.includes('\\u5c1a\\u672a\\u7ed1\\u5b9a\\u672c\\u5730\\u4e3b\\u4f53'),
  'the home page must keep an authenticated unbound account usable through the limited signed-preview experience',
);
assert.ok(
  customTabBar.includes("navigationMode === 'preview'")
    && customTabBar.includes('usesLimitedQuestionProjection')
    && customTabBar.includes('!isUnrecognizedIdentity(currentUser)'),
  'an unbound formal account must retain a visible question-preview navigation entry',
);
assert.ok(api.includes('createPaperExportTask') && api.includes('idempotencyKey'), 'paper exports must use the cloud idempotency contract');
assert.ok(api.includes('cancelPaperExportTask'), 'miniapp must support cancelling confirmed cloud export tasks');
assert.ok(api.includes('Cache-Control') && api.includes('no-cache'), 'miniapp API should bypass DevTools 304 caching for JSON endpoints');
assert.ok(api.includes("_t=${Date.now()}"), 'miniapp GET requests should include cache-busting query to avoid empty 304 responses');
assert.ok(cloudRelayRoute.includes('filterSnapshotForUser'), 'cloud relay should filter snapshots by user role');
assert.ok(cloudRelayRoute.includes('isStudentUser'), 'cloud relay should distinguish student users');
assert.ok(cloudRelayRoute.includes('student_pricings'), 'student snapshot filter should use course/schedule student links');
assert.ok(gatewayApp.includes("app.use('/api/cloud', optionalAuth, cloudRelayRouter)"), 'gateway should mount cloud relay with optional auth on its own line');
assert.ok(miniappHome.includes('getMiniappRolePolicy'), 'home page should use role-specific policy');
assert.ok(syncSource.includes('createCloudBusinessProjectionRuntime') && syncSource.includes('writeCache: (table: SyncTable, rows: any[]) => setCachedList(table, rows)'), 'cloud projection sync should cache only the cloud-scoped table lists');
assert.ok(!permission.includes("'teaching-tools'"), 'miniapp permission should not expose removed teaching tools module');
assert.ok(!miniappHome.includes("'teaching-tools'"), 'home page should not expose removed teaching tools module');
assert.ok(!appConfig.includes("'pages/tools/index'"), 'app config should not register removed teaching tools page');
assert.ok(!loginPage.includes('教学工具') && !loginPage.includes('teaching-tools'), 'login page should not mention removed teaching tools module');
assert.ok(!adminUsersPage.includes('teaching-tools') && !adminUsersPage.includes('教学工具'), 'admin user permissions should not mention removed teaching tools module');
assert.ok(adminUsersPage.includes('users:review'), 'review workbench should gate mutations on the server capability');
assert.ok(adminUsersPage.includes('adminApi.disableUser'), 'review workbench should call the real disable endpoint');
assert.ok(!adminUsersPage.includes('adminApi.reviewUser'), 'miniapp must not mutate legacy scalar roles');
assert.ok(adminUsersPage.includes('review_status'), 'review workbench should render review status');
assert.ok(adminUsersPage.includes('teacher_id'), 'teacher review should display the unique teacher binding');
assert.ok(adminUsersPage.includes('isFixedSuperAdmin') && adminUsersPage.includes('protected-badge'), 'review workbench should visibly protect the fixed super administrator');
assert.ok(adminUsersPage.includes('loading') && adminUsersPage.includes('empty') && adminUsersPage.includes('error'), 'review workbench should cover loading, empty and error states');
assert.ok(adminUsersPage.includes('lockedKeys'), 'review workbench should expose per-user and per-pairing saving state');
assert.ok(adminUsersPage.includes('createLatestRequestCoordinator'), 'review workbench should reject stale load responses');
assert.ok(adminUsersPage.includes('createOperationLocks'), 'review workbench should lock duplicate mutations by entity key');
assert.ok(!api.includes('approveApplication:')
  && !api.includes('rejectApplication:')
  && !api.includes('retryApplication:')
  && !api.includes('/api/miniapp/applications/admin'),
'miniapp API must not retain legacy role-review mutations');
assert.ok(!adminUsersPage.includes("capabilities.includes('applications:review')"), 'miniapp role review moved to the host signed-projection workbench');
assert.ok(!adminUsersPage.includes('applicationApi.'), 'miniapp administrator UI must not call legacy role application routes');
assert.ok(adminUsersPage.includes('read-only-notice'), 'ordinary administrators should receive an explicit read-only state');
assert.ok(api.includes('disableUser:'), 'miniapp admin API should expose the real disable endpoint');
assert.ok(api.includes('review_status'), 'miniapp user listing API should support review-status filtering');
assert.ok(api.includes('res.statusCode >= 400 && res.statusCode < 500'), 'miniapp API should preserve binding and validation error codes from review endpoints');
assert.ok(!assetsPage.includes('提交任务') && !assetsPage.includes('主机处理') && !assetsPage.includes('本地数据主机'), 'asset page should not expose implementation wording');
assert.ok(assetsStyles.includes('.task-title') && assetsStyles.includes('font-size: 30rpx'), 'asset import title should have a controlled miniapp font size');
assert.ok(assetsStyles.includes('.task-desc') && assetsStyles.includes('font-size: 24rpx'), 'asset import description should have a controlled miniapp font size');
assert.ok(!miniappHome.includes('student-dashboard-scope'), 'home page should not show explanatory student scope copy');
assert.ok(miniappHome.includes("!['student', 'pending'].includes(access.role)"), 'home page should hide management shortcuts from students and pending users');
assert.ok(miniappHome.includes('access.canReadUsers'), 'home review workbench entry should follow server-derived read capability');
assert.ok(miniappHome.includes('access.canReviewUsers'), 'home review workbench copy should distinguish reviewer and read-only admin');
assert.ok(!miniappHome.includes('账号与邀请'), 'home should remove legacy invitation wording');
assert.ok(miniappHome.includes('pullFromCloudBusinessProjection') && syncSource.includes('createCloudBusinessProjectionRuntime'), 'home dashboard should consume cloud-scoped collections before aggregation');
assert.ok(miniappHome.includes('setBusinessCacheIdentity'), 'home should activate the authenticated cache namespace before reads');
assert.ok(storageSource.includes('cache_${activeCacheIdentity}_${table}'), 'business cache keys should be identity scoped');
assert.ok(storageSource.includes('previousIdentity !== nextIdentity'), 'business cache should clear the prior identity namespace on account switch');
assert.ok(loginPage.includes('createNormalSessionCommitter') && loginPage.includes('setBusinessCacheIdentity,'), 'login should atomically switch the business cache identity after authentication');
assert.ok(loginPage.includes('createNormalSessionCommitter') && loginPage.includes('loginBusyRef'), 'the single verified-phone login must use the atomic session committer and a shared synchronous mutex');
assert.ok(!loginPage.includes('createReviewSessionCommitter') && !loginPage.includes('reviewDemoApi'), 'removed review identities must not have a client login path');
assert.ok(miniappHome.includes('isUnrecognizedIdentity') && miniappHome.includes('AccountStatusBanner'), 'home must isolate the real unrecognized identity before formal API loading');
assert.ok(schedulePage.includes('isUnrecognizedIdentity') && schedulePage.includes('AccountStatusBanner'), 'schedule must render a real empty state without calling formal APIs for unrecognized identities');
assert.ok(
  schedulePage.includes('isVisitorIdentity') && schedulePage.includes('isLimitedIdentity'),
  'visitor schedule route must fail closed before reading raw business caches',
);
assert.ok(
  questionBankPage.includes('isUnrecognizedIdentity')
    && questionBankPage.includes("Taro.reLaunch({ url: '/pages/unrecognized-experience/index' })"),
  'question bank must route unrecognized identities to the isolated registered four-question experience',
);
assert.ok(
  !questionBankPage.includes('UnrecognizedExperienceContent'),
  'formal question bank must not bundle the isolated experience page implementation',
);
assert.ok(
  questionBankPage.includes('if (isUnrecognized) return;')
    && questionBankPage.includes('loadQuestions();')
    && questionBankPage.includes('if (!useLimitedProjection) refreshAll();'),
  'unrecognized identities must not load questions, and limited-preview identities must not load task state',
);
assert.ok(customTabBar.includes('EXPERIENCE_TABS') && customTabBar.includes("navigationMode === 'unrecognized'"), 'unrecognized identities need the four-tab restricted shell');
assert.ok(loginPage.includes('createAuthenticationEntryBoundary') && loginPage.includes('loginBoundary.run(() => Taro.login())'), 'normal platform login must remain bound to its starting session before any WeChat request or commit');
assert.ok(customTabBar.includes("return 'pending'"), 'tab bar should fail closed when no authenticated role is available');
assert.ok(customTabBar.includes("userType === 'pending' ? LIMITED_TABS"), 'pending users should not receive business navigation tabs');
assert.ok(appConfig.includes("'pages/question-bank/index'"), 'app config should register the question bank page');
assert.ok(questionBankPage.includes('miniappCloudBusinessApi.createPaperExportTask'), 'question bank page should submit cloud question export operations');
assert.ok(questionBankPage.includes("'question-paper'"), 'question bank page should support paper assembly');
assert.ok(questionBankPage.includes("'paper-export-word'"), 'question bank page should support Word export');
assert.ok(questionBankPage.includes("'paper-export-pdf'"), 'question bank page should support PDF export');
assert.ok(questionBankPage.includes('miniappCloudBusinessApi.readPaperExportTask'), 'question bank page should check cloud paper/export task results');
assert.ok(questionBankPage.includes('createQuestionPaperTaskCacheRuntime') && !questionBankPage.includes("const TASKS_KEY = 'question_paper_tasks_v2'"), 'question bank task history must use the complete authenticated scope namespace');
assert.ok(questionBankPage.includes('createQuestionPaperTaskCacheRuntime') && questionBankPage.includes('taskState.scopeKey'), 'mounted question-bank task state must bind writes to the scope that produced the snapshot');
assert.ok(questionBankPage.includes('miniappCloudBusinessApi.requestPaperExportDelivery'), 'question bank must request NAS-backed artifact delivery through cloud');
assert.ok(questionBankPage.includes('miniappCloudBusinessApi.downloadPaperExportDelivery'), 'question bank must use the cloud delivery download helper');
assert.ok(questionBankPage.includes('await Taro.openDocument'), 'question bank must open the temporary cloud-delivery file');
assert.ok(!questionBankPage.includes('accessEndpoint') && !questionBankPage.includes("'x-gewu-artifact-token'"), 'artifact download must not expose a direct storage access endpoint');
assert.ok(!questionBankPage.includes('questionCount:'), 'paper submission must send exact ordered questionIds rather than a count');
assert.ok(!api.includes('studentApi') || !api.includes("create: (data: any) => api.post<any>('/scheduling/students'"), 'miniapp API must not expose direct student create');
assert.ok(!api.includes('studentApi') || !api.includes('update: (id: string, data: any) => api.put<any>(`/scheduling/students/${id}`'), 'miniapp API must not expose direct student update');
assert.ok(!api.includes('courseApi') || !api.includes("create: (data: any) => api.post<any>('/scheduling/courses'"), 'miniapp API must not expose direct course create');
assert.ok(!api.includes('scheduleApi') || !api.includes("create: (data: any) => api.post<any>('/scheduling/schedules'"), 'miniapp API must not expose direct schedule create');
assert.ok(!api.includes('paymentApi') || !api.includes("create: (data: any) => api.post<any>('/scheduling/payments'"), 'miniapp API must not expose direct payment create');
assert.ok(!api.includes('gradeApi') || !api.includes("create: (data: any) => api.post<any>('/scheduling/grades'"), 'miniapp API must not expose direct grade create');
assert.ok(!studentsPage.includes('withOfflineSupport') && !studentsPage.includes('addPendingChange'), 'students page should not queue core writes');
assert.ok(!teachersPage.includes('withOfflineSupport') && !teachersPage.includes('addPendingChange'), 'teachers page should not queue core writes');
assert.ok(!paymentsPage.includes('withOfflineSupport') && !paymentsPage.includes('addPendingChange'), 'payments page should not queue core writes');
assert.ok(!schedulePage.includes('/pages/schedule/edit/index'), 'schedule page should not expose edit entry');
assert.ok(!scheduleDetailPage.includes('addPendingChange') && !scheduleDetailPage.includes('updateLocalItem'), 'schedule detail should not update schedule status');
assert.ok(!miniappHome.includes('/api/stats/revenue'), 'home page should not fire unused revenue stats requests on launch');
assert.ok(schedulePage.includes('day-column-inner'), 'schedule page should put day column padding on an inner view instead of scroll-view descendants');
assert.ok(scheduleStyles.includes('.day-column-inner'), 'schedule styles should define the inner day column spacing class');
assert.ok(sharedComponents.includes('className="pr-scroll"'), 'PullRefreshView should keep padding classes off the scroll-view');
assert.ok(!sharedComponents.includes('className={`pr-scroll ${className || \'\'}'), 'PullRefreshView should not attach page padding classes to scroll-view');
assert.ok(
  /\.teachers-page\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s.test(teachersStyles)
    && /\.teacher-list\s*\{[^}]*flex:\s*1;/s.test(teachersStyles),
  'teachers page must give PullRefreshView a flex-column parent and a flexible list height so populated review data remains visible'
);
assert.ok(!sharedComponents.includes('Taro.getNetworkType'), 'NetworkStatus should not call getNetworkType on mount because WeChat DevTools can emit internal timeout errors');
assert.ok(coursesPage.includes('className="course-scroll"') && coursesPage.includes('className="course-list"'), 'courses page should separate scroll container from padded list');
assert.ok(paymentsPageSource.includes('className="pay-scroll"') && paymentsPageSource.includes('className="pay-list"'), 'payments page should separate scroll container from padded list');

console.log('miniapp access policy checks passed');
