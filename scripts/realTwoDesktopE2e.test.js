'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'real-two-desktop-e2e.js'), 'utf8');
const governanceSource = fs.readFileSync(path.join(__dirname, 'realTwoDesktopProcessGovernance.js'), 'utf8');
const windowRestoreSource = fs.readFileSync(path.join(__dirname, 'restoreProcessWindow.ps1'), 'utf8');
const isolatedCloudSource = fs.readFileSync(path.join(__dirname, 'isolated-desktop-identity-cloud.js'), 'utf8');

assert.ok(isolatedCloudSource.includes("app.use('/api/auth', authRouter)"),
  'the disposable cloud must expose the real miniapp manual-phone login router');
assert.ok(isolatedCloudSource.includes("app.use('/api/miniapp/applications', authMiddleware"),
  'the disposable cloud must expose the real miniapp role-application command router');
assert.ok(isolatedCloudSource.includes('createAuthorityCloudControlService'),
  'the disposable cloud must use the production cloud-owned account/host-owned role control service');
assert.ok(isolatedCloudSource.indexOf("app.get('/api/authority/host/control-records'")
  < isolatedCloudSource.indexOf("app.use('/api/authority', authorityApiRouter)"),
  'production-style cloud control routes must intercept the shared backend authority router in isolated acceptance');
assert.ok(isolatedCloudSource.includes('createAuthorityProtocolRouter({')
  && isolatedCloudSource.includes('enqueueCommand: envelope => miniappCommandInbox.enqueue(envelope)')
  && isolatedCloudSource.includes('claimCommands: input => miniappCommandInbox.claim(input)'),
  'isolated acceptance must use one production authority router and inbox for enqueue and host claim');

assert(source.includes('async function loopbackHealth'), 'LOOPBACK_HEALTH_PROBE_REQUIRED');
assert(source.includes("childProcess.execFile('curl.exe'"), 'LOOPBACK_HEALTH_CURL_CLIENT_REQUIRED');
assert(source.includes('IDENTITY_CLOUD_LISTEN_READY_REQUIRED'), 'IDENTITY_CLOUD_LISTEN_EVENT_REQUIRED');
assert.ok(source.includes('GEWU_PACKAGED_EXECUTABLE_REQUIRED'),
  'packaged E2E must reject an empty executable setting before path.resolve turns it into the workspace directory');
assert(source.includes('let cloud = null;'), 'IDENTITY_CLOUD_LIFECYCLE_GUARD_REQUIRED');
assert(source.includes("cloud?.child?.pid"), 'IDENTITY_CLOUD_FAILURE_CLEANUP_REQUIRED');
assert(source.includes('HOST_DEVICE_APPROVE_DIAGNOSTIC_FAILED'), 'HOST_APPROVAL_ORIGINAL_FAILURE_PRESERVATION_REQUIRED');
const actionSource = fs.readFileSync(path.join(__dirname, 'realDesktopCdpAction.js'), 'utf8');
const publicElectronSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'electron.js'), 'utf8');
assert.doesNotThrow(() => new Function(source), 'the real UI harness must remain syntactically executable');
assert.ok(source.includes('connectRealDesktopPage'));
assert.ok(source.includes('window.primaryHostRuntime.workerStatus()'));
assert.strictEqual(source.includes('pairClientDirect'), false,
  'the managed-identity acceptance run must not retain the retired direct pairing-code path');
assert.strictEqual(source.includes('issuePairingCode'), false,
  'the managed-identity acceptance run must not issue a legacy pairing code');
assert.strictEqual(source.includes('/api/cloud-relay-host/tasks/process'), false,
  'real two-desktop E2E must not manually process host relay tasks');
assert.strictEqual(source.includes('/api/cloud/desktop-session/'), false,
  'real two-desktop E2E must not use the retired desktop-session relay contract');
assert.ok(source.includes('/api/authority/commands'),
  'real two-desktop E2E must exercise the formal authority command contract');
assert.ok(source.includes("'--lan'") && source.includes("'--cloud-relay'") && source.includes("'--restart'")
  && source.includes("'--websocket-disabled'") && source.includes("'--no-authority-data'"),
  'the isolated acceptance invocation must explicitly declare its LAN, relay, restart, WebSocket, and no-real-data modes');
assert.ok(source.includes('authorizeIsolatedCutoverFixture') && source.includes('promoteAuthorityCutover'),
  'the disposable authority fixture must atomically promote a verified migration copy before testing the cutover runtime');
assert.strictEqual(source.includes('writeAuthorityCutoverMarker'), false,
  'the harness must not write a marker into an unmigrated source or double-write after atomic promotion');
assert.ok(source.includes('ISOLATED_CUTOVER_ACTIVE_ACCOUNT_REQUIRED')
  && source.includes('ISOLATED_CUTOVER_ACTIVE_GRANT_REQUIRED'),
  'the promoted active database must prove the current authority account and canonical super-admin binding before desktop startup');
assert.ok(source.includes('ISOLATED_CUTOVER_REPLAY_ACCOUNT_REQUIRED')
  && source.includes('ISOLATED_CUTOVER_REPLAY_GRANT_REQUIRED')
  && !source.includes('commandReplay: () => []'),
  'the isolated cutover fixture must provide an explicit replay verifier rather than accepting an empty default callback');
assert.ok(source.includes('GEWU_AUTHORITY_WEBSOCKET_DISABLED'),
  'the explicit WebSocket-disabled acceptance mode must reach the packaged desktop process');
assert.ok(source.includes('startIdentityCloud'),
  'the acceptance harness must launch a disposable local control plane rather than require an operator cloud token');
assert.ok(source.includes("GEWU_E2E_MANAGED_CLOUD_BASE_URL: runtimeConfig.managedCloudBaseUrl"),
  'the isolated desktop process must explicitly receive the disposable managed-cloud endpoint rather than fall back to production');
assert.ok(source.includes('IDENTITY_CLOUD_LISTEN_READY_REQUIRED'));
assert.ok(source.includes('/__e2e/confirm-latest'),
  'only simulated WeChat phone confirmation may use a test cloud endpoint');
assert.ok(source.includes('GEWU_PACKAGED_COLD_START_TIMEOUT_MS'));
assert.ok(source.includes('withFreshCdpPage'));
assert.strictEqual(source.includes("realDesktopCdpAction.js"), false,
  'E2E actions must not use per-action subprocesses that can time out before UI input');
assert.ok(source.includes('HOST_WORKER_NOT_RUNNING'));
assert.ok(source.includes('HOST_MAIN_NAVIGATION_REQUIRED'),
  'unlock acceptance must wait for the visible host navigation, not only a transient lock label');
assert.ok(source.includes('HOST_DIRECT_RUNTIME_AFTER_BOOTSTRAP_REQUIRED'),
  'a first-time host activation may validly enter the runtime directly without a redundant second unlock form');
assert.ok(source.includes('clickTextWhenAvailable'),
  'navigation actions must tolerate the renderer transition after unlock');
assert.ok(source.includes('ensurePinnedNavigation'),
  'the real UI harness must expose the hover-only sidebar before selecting nested pages');
assert.ok(source.includes('HOST_NAVIGATION_VISIBLE_REQUIRED'),
  'the harness must wait for the sidebar slide-in transition before clicking a nested menu');
assert.ok(source.includes('openMenuGroup'),
  'the harness must wait until the rendered submenu is expanded before selecting a child page');
assert.ok(source.includes('HOST_MENU_GROUP_PAINTED_REQUIRED')
  && source.includes('ant-motion-collapse-enter-start')
  && source.includes('submenuBox.height > 0')
  && source.includes('submenu.contains(hit)'),
  'aria-expanded alone must not accept an AntD submenu whose entering container is still height-zero and clipping every child');
assert.ok(source.includes('HOST_MENU_GROUP_REOPEN_REQUIRED')
  && source.includes('if (isOpen && !isPainted)')
  && source.includes("getAttribute('aria-expanded') === 'false'"),
  'a height-zero submenu left open by a background refresh must be closed and reopened through the rendered group control');
assert.ok(source.includes('function activateDesktopWindow')
  && source.includes('restoreProcessWindow.ps1')
  && windowRestoreSource.includes('WScript.Shell')
  && windowRestoreSource.includes('AppActivate')
  && windowRestoreSource.includes('ShowWindowAsync')
  && windowRestoreSource.includes('SW_RESTORE')
  && windowRestoreSource.includes('SetForegroundWindow')
  && source.includes('HOST_WINDOW_ACTIVATION_REQUIRED')
  && source.includes('CLIENT_WINDOW_ACTIVATION_REQUIRED'),
  'real UI switching must restore and foreground the exact packaged desktop window so a minimized/hidden renderer cannot freeze AntD motion');
assert.ok(source.includes("bringToFront: () => withFreshCdpPage")
  && source.includes("page.send('Page.bringToFront')")
  && source.includes('await page.bringToFront();'),
  'host approval navigation must explicitly foreground every freshly connected CDP page before waiting for AntD motion');
assert.ok(source.includes('MENU_GROUP_PAINT_DIAGNOSTIC')
  && source.includes('document.visibilityState')
  && source.includes('document.hasFocus()')
  && source.includes('requestAnimationFrame'),
  'a stuck submenu transition must report document focus/visibility and whether animation frames are advancing');
assert.ok(source.includes('openMenuItem'),
  'the harness must select nested pages through their rendered menu items');
assert.ok(source.includes("openMenuItem(page, 'identity-devices', 'HOST_IDENTITY_ROUTE_REQUIRED')"),
  'identity navigation must select the rendered nested identity-devices menu item rather than only click its text node');
assert.ok(source.includes("async function openHostIdentity(page) {\n  await page.bringToFront();\n  try {")
  && source.includes("  } finally {\n    await releaseNavigationOverlay(page);\n  }\n"),
  'identity navigation must always close the expanded sidebar overlay after completing or aborting navigation');
const openHostIdentityStart = source.indexOf('async function openHostIdentity(page) {');
const initialIdentityRouteWait = source.indexOf("await waitBody(page, '\\u6211\\u7684\\u8bbe\\u5907', 'HOST_IDENTITY_UI_MISSING', 5_000);", openHostIdentityStart);
const identitySidebarRelease = source.indexOf('await releaseNavigationOverlay(page);', openHostIdentityStart);
assert.ok(openHostIdentityStart >= 0 && initialIdentityRouteWait > openHostIdentityStart
  && identitySidebarRelease > initialIdentityRouteWait,
  'the harness must wait until the identity route is rendered before retracting its pinned sidebar');
assert.ok(source.includes('HOST_MENU_ITEM_VISIBLE_REQUIRED'),
  'the harness must wait for a submenu item to finish its expand animation before clicking');
assert.ok(source.includes('HOST_MENU_VISIBILITY_TIMEOUT_MS = 8_000')
  && source.includes('HOST_MENU_ROUTE_TIMEOUT_MS = 12_000')
  && source.includes('for (let attempt = 0; attempt < 2; attempt += 1)'),
  'real menu navigation must fail with diagnostics inside a bounded resource window rather than holding two Electron apps through nested 45-second retries');
assert.ok(source.includes('MENU_TARGET_HIT_DIAGNOSTIC')
  && source.includes('hitClass')
  && source.includes('hitText')
  && source.includes('itemPointerEvents')
  && source.includes('hitPointerEvents')
  && source.includes('itemTransform')
  && source.includes('submenuRect')
  && source.includes('submenuOverflow')
  && source.includes('submenuDisplay'),
  'a rejected visible menu target must record the actual center-point hit element needed for root-cause analysis');
assert.ok(source.includes('HOST_MENU_GROUP_VISIBLE_REQUIRED MENU_GROUP_STATE='),
  'a failed top-level menu navigation must preserve sidebar and candidate-node diagnostics for root-cause analysis');
assert.ok(source.includes('async function markVisibleMenuTarget')
  && source.includes('data-real-desktop-menu-target')
  && source.includes('document.querySelectorAll(${literal(selector)})'),
  'menu navigation must target the visible hit-tested menu node, not the first matching AntD node during sidebar animation');
assert.ok(source.includes('ensureVisibleMenuElement') && source.includes('const centerX = rect.left + rect.width / 2')
  && source.includes('centerX >= 0 && centerX <= window.innerWidth')
  && source.includes("await ensurePinnedNavigation(page)"),
  'the harness must distinguish an offscreen menu from an AntD item with a harmless negative left margin whose center remains clickable');
assert.ok(source.includes('await ensurePinnedNavigation(page);\n    return markVisibleMenuTarget(page, selector);'),
  'menu visibility polling must re-pin a sidebar that retracts again during its slide-in transition');
assert.ok(source.includes('await page.nativeClick(target);') && source.includes('HOST_MENU_ITEM_SETTLED_REQUIRED'),
  'navigation must retry the real submenu click until its selected state is rendered');
assert.ok(source.includes("app-shell__content--${itemKey}") && source.includes('selected && routeRendered'),
  'a selected AntD menu item alone must never be accepted as navigation: the requested content route must be rendered too');
assert.ok(source.includes('HOST_MENU_ITEM_SETTLED_REQUIRED'),
  'the harness must wait for the rendered submenu interaction state to settle before clicking');
const startDesktopSource = source.slice(
  source.indexOf('function startDesktop('),
  source.indexOf('async function stopProfile('),
);
assert.ok(startDesktopSource.includes('e2e-packaged-desktop.log')
  && startDesktopSource.includes("fs.openSync(diagnosticLog, 'a')")
  && startDesktopSource.includes("stdio: ['ignore', diagnosticFd, diagnosticFd]")
  && startDesktopSource.includes('fs.closeSync(diagnosticFd)')
  && !startDesktopSource.includes('child.stderr.pipe(diagnosticStream)'),
  'packaged desktop diagnostics must use inherited file descriptors without retaining Node pipe streams and handles');
assert.ok(startDesktopSource.includes('--disable-background-timer-throttling')
  && startDesktopSource.includes('--disable-renderer-backgrounding')
  && startDesktopSource.includes('--disable-backgrounding-occluded-windows'),
  'the two-desktop harness must keep the real host renderer responsive while the client window is foregrounded for approval');
assert.ok(source.includes('tmp-e2e-host-[a-z0-9-]+'),
  'every explicitly marked temporary host package must bypass installed-host firewall auditing');
assert.ok(source.includes('acquireRunLease') && governanceSource.includes('REAL_TWO_DESKTOP_E2E_ALREADY_RUNNING'),
  'the harness must enforce a single active two-desktop acceptance runner');
assert.ok(governanceSource.includes('STALE_REAL_TWO_DESKTOP_PROCESSES_REQUIRED_CLEANUP')
  && governanceSource.includes('REAL_TWO_DESKTOP_PROCESS_BUDGET_EXCEEDED'),
  'the harness must reject stale temporary desktops and cap the active packaged process count');
assert.ok(source.includes('waitForProcessesExit') && governanceSource.includes('REAL_TWO_DESKTOP_PROCESS_EXIT_TIMEOUT'),
  'profile teardown must wait for every exact packaged PID before attempting temporary-root cleanup');
assert.ok(source.includes("Get-CimInstance Win32_Process -Filter \"Name='格物工坊.exe'\""),
  'the live-process audit must query only packaged desktop processes instead of scanning every Windows process');
assert.ok(source.includes('timeout: 45_000'),
  'the exact packaged-process audit must tolerate a temporarily busy Windows CIM provider');
assert.ok(!source.includes("const ROOT = fs.mkdtempSync")
  && source.indexOf('acquireRunLease({ lockPath: RUN_LOCK_PATH })') < source.indexOf('initializeDisposableRoots();'),
  'the harness must acquire its single-run lease before creating a temporary profile root');
assert.ok(source.includes('startProcessGuardian')
  && source.indexOf('startProcessGuardian(') < source.indexOf('host = startDesktop(')
  && source.includes('await stopProcessGuardian(processGuardian)'),
  'an independent pipe guardian must be active before Electron starts and must be joined during normal teardown');
assert.ok(source.includes('HOST_IDENTITY_GATE_REQUIRED'),
  'the harness must wait for the identity gate instead of sampling the renderer during its loading transition');
assert.ok(source.includes('HOST_DEVICE_APPROVE_ACTION_REQUIRED'),
  'ordinary device approval must click the rendered host approval action');
assert.ok(source.includes('HOST_DEVICE_APPROVE_MODAL_OR_RESULT_REQUIRED')
  && source.includes("return modalOpen || approved ? { modalOpen, approved } : null;"),
  'a rendered approval click must wait for either its confirmation modal or a rendered approval result; an unpainted modal is not success');
assert.ok(source.includes('HOST_DEVICE_APPROVE_CONFIRMATION_DISPATCH_REQUIRED')
  && source.includes('await clickVisibleModalText(page,')
  && source.includes("}, 'HOST_DEVICE_APPROVE_CONFIRMATION_DISPATCH_REQUIRED', 30_000);"),
  'the approval confirmation must dispatch exactly once before its independently-rendered result is asserted');
assert.ok(source.includes('function clickPaintedText(page, text)')
  && source.includes('const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);')
  && source.includes('return Boolean(hit && (hit === item || item.contains(hit)));'),
  'text actions must choose a painted, topmost control instead of reporting a click on a hidden duplicate');
assert.ok(source.includes("waitBody(page, '\\u5df2\\u6279\\u51c6\\uff0c\\u7b49\\u5f85\\u65b0\\u8bbe\\u5907\\u5b8c\\u6210\\u8bbe\\u7f6e'") && source.includes('HOST_DEVICE_APPROVED_PENDING_STATUS_REQUIRED'),
  'approval acceptance must prove that the host UI projects the approved-pending status, not merely that an approval action returned');
assert.ok(source.includes('HOST_BOOTSTRAP_IDENTITY_CHALLENGE_REQUIRED') && source.includes('\\b[0-9]{6}\\b'),
  'host bootstrap must recognize the rendered numeric request code instead of requiring non-visible accessibility text');
assert.ok(source.includes('releaseNavigationOverlay') && source.includes('HOST_NAVIGATION_OVERLAY_HIDDEN_REQUIRED'),
  'device approval must close the temporary navigation overlay before clicking a left-edge action');
assert.ok(source.includes('HOST_NAVIGATION_TOGGLE_REQUIRED'),
  'host approval must wait for the relaunched navigation toggle to render before native clicking it');
assert.ok(source.includes('CLIENT_NAVIGATION_TOGGLE_OBSCURED_RETRY_REQUIRED')
  && source.includes("error?.message?.includes('REAL_DESKTOP_CDP_TARGET_OBSCURED')"),
  'a restarted ordinary desktop must retry the visible navigation toggle when an animation or overlay briefly covers it');
assert.ok(source.includes("await clickText(page, '\\u5237\\u65b0\\u72b6\\u6001');") && source.includes('HOST_DEVICE_APPROVE_ACTION_REQUIRED'),
  'host approval must refresh the visible device list until an actionable approval control appears');
assert.ok(source.includes('CONTROL_PLANE=${JSON.stringify(state)') && source.includes('HOST_PAGE=${rendered}'),
  'a failed visible host approval must preserve isolated control-plane and UI diagnostics');
assert.ok(source.includes('CAUSE_DETAIL=${causeDetail}'),
  'a failed visible host approval must preserve the nested navigation diagnostic instead of reducing it to an error code');
assert.ok(source.includes('personal-asset-account.create.v1') && source.includes('LAN_DRAFT_CONFIRM_DIALOG_REQUIRED') && source.includes("'lan-websocket'"),
  'the real two-desktop run must seed only a disposable draft, then visibly confirm a LAN command and require a LAN receipt');
assert.ok(source.includes('function probeAuthoritySocket') && source.includes('LAN_SOCKET_READY_REQUIRED'),
  'the LAN acceptance must prove the host authority socket is reachable before the visible command confirmation');
assert.ok(source.includes('if (!acceptance.websocketDisabled) {\n      await probeAuthoritySocket')
  && source.includes("acceptance.websocketDisabled ? 'durable-relay' : (acceptance.relayWebSocket ? 'relay-websocket' : 'lan-websocket')"),
  'the relay fallback acceptance must skip the intentionally disabled LAN socket and require a durable relay receipt');
assert.ok(source.includes("'--relay-websocket'")
  && source.includes('relayWebSocket: provided.has(\'--relay-websocket\')')
  && source.includes("acceptance.relayWebSocket ? 'relay-websocket'"),
  'the matrix must provide a distinct relay-WebSocket mode with its own receipt requirement');
assert.ok(source.includes('HOST_CLOUD_RELAY_CONNECTED_REQUIRED')
  && source.includes("window.primaryHostRuntime.runtimeStatus()")
  && source.includes("status?.cloud?.state === 'connected'"),
  'relay-WebSocket acceptance must read the packaged host runtime cloud status before submitting');
assert.ok(source.includes('function configuredCloudRelayConnectTimeoutMs')
  && source.includes('Number.isFinite(configured)')
  && source.includes('configuredCloudRelayConnectTimeoutMs(process.env)'),
  'relay-WebSocket acceptance must reject an invalid timeout override instead of failing immediately');
assert.ok(source.includes('const isolatedLanPort = acceptance.relayWebSocket ? await freePort() : null;')
  && source.includes('hostBaseUrl: acceptance.relayWebSocket')
  && source.includes('LAN_ISOLATION_REQUIRED'),
  'the relay-WebSocket mode must configure an unused LAN endpoint and prove it remains unreachable');
assert.ok(source.includes('DRAFT_CONFIRMATION_NOT_OBSERVED')
  && source.includes("latestDraft?.item?.status !== 'awaiting_confirmation'"),
  'a visible confirmation click must prove the outbox draft left its unconfirmed state before transport evidence is accepted');
assert.ok(source.includes('Network.emulateNetworkConditions')
  && source.includes('OFFLINE_DRAFT_AWAITING_CONFIRMATION_REQUIRED')
  && source.includes('OFFLINE_DRAFT_NETWORK_RESTORE_REQUIRED')
  && source.includes('CLIENT_OFFLINE_DRAFT_RESTART_REQUIRED')
  && source.includes('CLIENT_OFFLINE_DRAFT_PROCESS_STOPPED_REQUIRED')
  && source.includes('CLIENT_OFFLINE_DRAFT_PROFILE_RELEASE_REQUIRED')
  && source.includes('CLIENT_OFFLINE_DRAFT_MAIN_UI_REQUIRED')
  && source.includes('CLIENT_OFFLINE_DRAFT_MAIN_UI_DIAGNOSTIC')
  && source.includes('OFFLINE_DRAFT_RESTART_STATE_REQUIRED')
  && source.includes('OFFLINE_DRAFT_SINGLE_RECEIPT_REQUIRED'),
  'the isolated acceptance must create a renderer-network-offline draft, restart the actual client, preserve it unconfirmed, then visibly submit exactly one receipt');
assert.ok(source.includes('DRAFT_CONFIRMATION_NOT_OBSERVED DRAFT=${JSON.stringify(latestDraft)} UI=${latestUi}'),
  'a missing confirmation transition must retain the rendered outbox page and draft state for root-cause diagnosis');
assert.ok(source.includes('HOST_LOCAL_AUTHORITY_WRITE_REQUIRED')
  && source.includes('executeLocalDraft')
  && source.includes("personal-asset-record.create.v1")
  && source.includes("receipt?.status !== 'committed'")
  && source.includes('HOST_REVERSE_PROJECTION_REQUIRED')
  && source.includes('async function verifyHostReverseProjection(clientPage, recordNote, minSourceVersion = 0)')
  && source.includes('reverseProjectionVersion = await writeHarmlessHostBusinessRecord')
  && source.includes('verifyHostReverseProjection(clientPage, reverseRecordNote, reverseProjectionVersion)')
  && source.includes('getAllAssetRecords'),
  'the real matrix must write through the host authority bridge and verify its scoped projection reached the ordinary desktop cache');
assert.ok(source.includes('HOST_REVERSE_PROJECTION_DIAGNOSTIC')
  && source.includes('LAST_PROBE=${JSON.stringify(lastProbe)}')
  && source.includes('LAST_EVALUATION_ERROR=${lastEvaluationError || \'NONE\'}'),
  'a failed host-to-client projection must retain its final client read result or CDP evaluation error for diagnosis');
assert.ok(!source.includes("submitHarmlessLanCommandThroughUi(hostPage"),
  'the primary host must never send itself a client outbound authority command during reverse-projection acceptance');
assert.ok(/processOnce:\s*async \(\) => \{\s*await refreshControlRecords\(\);\s*const result = await authorityRuntime\.processor\.processOnce\(\);/s.test(publicElectronSource),
  'the durable relay worker must refresh the authority control snapshot before it authorizes each claimed command');
assert.ok(source.includes('UI=${latestUi}'),
  'a missing LAN receipt must preserve the rendered authority outbox error for diagnosis');
assert.ok(source.includes('LAN_DRAFT_SUBMISSION_ERROR_REQUIRED') && source.includes('submissionError'),
  'a missing LAN receipt must retain any transient visible submission error instead of losing it during receipt polling');
assert.ok(source.includes("await clickVisibleModalText(page, '\\u786e\\u8ba4\\u5e76\\u53d1\\u9001');")
  && source.includes('LAN_DRAFT_CONFIRM_BUTTON_REQUIRED')
  && !source.includes('LAN_DRAFT_CONFIRM_MODAL_DISMISS_REQUIRED'),
  'the authority submission must native-click the visible confirmation button, then poll the durable receipt without requiring an async AntD modal to close first');
assert.ok(source.includes('HOST_AUTHORITY_RELAUNCH_BACKEND_REQUIRED') && source.includes("'HOST_AUTHORITY_RELAUNCH_UI_REQUIRED', 90_000"),
  'the authority restart must wait for both backend health and a stable renderer before continuing');
assert.ok(source.includes("HOST_RECOVERY_REVEAL_REQUIRED") && source.includes("clickText(page, '\\u663e\\u793a\\u4e00\\u6b21\\u6027\\u6062\\u590d\\u5305')"),
  'recovery-package delivery must retry the rendered reveal action until the required acknowledgement control is visible');
assert.ok(source.includes('HOST_AUTHORITY_RELAUNCH_GATE_REQUIRED') && source.includes("fillByPlaceholder(relaunched, '\\u8bf7\\u8f93\\u5165\\u672c\\u673a\\u5bc6\\u7801', HOST_PASSWORD)"),
  'the authority restart must explicitly unlock the security gate before expecting the host main page');
assert.ok(source.includes("['/PID', String(pid), '/F']")
  && !source.includes("['/PID', String(pid), '/T', '/F']"),
  'temporary packaged Electron profiles must terminate only explicitly enumerated profile PIDs, never a recursive process tree that can include the acceptance runner');
assert.ok(source.includes('TEMPORARY_PROFILE_CLEANUP_DEFERRED') && source.includes('Do not replace the authority/LAN assertion'),
  'Windows profile cleanup contention must not hide the authoritative E2E assertion failure');
assert.ok(source.includes("await page.nativeClick('.app-shell__sider-unpin');") && source.includes('nativeMove: ({ x, y })') && source.includes('await page.nativeMove(safePoint);'),
  'the sidebar overlay must release its pin and move the pointer out of its hover area before page actions continue');
assert.ok(source.includes('HOST_NAVIGATION_RETREATED_REQUIRED') && source.includes('rect.right <= 1'),
  'the sidebar overlay must finish sliding completely out of the viewport before content actions continue');
assert.ok(source.includes("  } finally {\n    await releaseNavigationOverlay(page);\n  }"),
  'a failed identity navigation must still release the sidebar overlay before reporting the error');
assert.ok(source.includes("code: cause.code || 'HOST_AUTHORITY_BOOTSTRAP_READY_REQUIRED'") && source.includes('PAGE=${rendered} STATE=${JSON.stringify(state)') && source.includes('/__e2e/state'),
  'a failed primary-host phone-confirmation refresh must retain isolated UI and control-plane diagnostics');
assert.ok(source.includes("await clickText(page, '\\u6211\\u5df2\\u5728\\u5fae\\u4fe1\\u5b8c\\u6210\\uff0c\\u5237\\u65b0\\u72b6\\u6001');") && source.includes('await sleep(700);'),
  'host bootstrap must retry the rendered phone-confirmation refresh until its visible state changes');
assert.ok(source.includes('scrollIntoView'),
  'native UI clicks must scroll off-screen controls into the Electron viewport first');
assert.ok(source.includes("document.querySelectorAll('button,[role=\"button\"],a')") && source.includes('const clickable = interactive || fallback?.closest'),
  'text actions must prefer an actual interactive control over a surrounding layout div');
assert.ok(source.includes("replace(/\\\\s+/g, '') === text"),
  'real UI actions must ignore typography whitespace inserted inside button labels');
assert.ok(source.includes('windowsHide: false'),
  'a real visible-desktop acceptance run must not hide either Electron window');
assert.ok(/async function nativeClickDirect\(page, selector\) \{\s*await page\.send\('Page\.bringToFront'\);[\s\S]*?const \{ x, y \} = await nativeTargetCenter\(page, selector\);[\s\S]*?await page\.send\('Input\.dispatchMouseEvent', \{ type: 'mouseMoved', x, y, button: 'none', buttons: 0 \}\);\s*await sleep\(80\);\s*await page\.send\('Input\.dispatchMouseEvent', \{ type: 'mousePressed'/s.test(source),
  'native menu clicks must focus the target page and let Electron process hover before the press event');
assert.ok(source.includes('document.elementFromPoint') && source.includes('REAL_DESKTOP_CDP_TARGET_OBSCURED'),
  'native desktop clicks must prove their coordinate is not covered by an overlay before accepting the interaction');
assert.ok(source.includes('buttons: 1') && source.includes('buttons: 0'),
  'native CDP pointer events must carry pressed and released button state');
assert.ok(source.includes('REAL_DESKTOP_CDP_CLICK_EVENT_MISSING'),
  'native desktop clicks must distinguish an undelivered CDP pointer event from a visible UI handler failure');
assert.ok(source.includes('REAL_DESKTOP_CDP_CLICK_RETRY_REQUIRED') && source.includes('attempt < 2'),
  'a visible target with one undelivered native click must receive one fresh-coordinate retry before the E2E row fails');
assert.ok(source.includes('HOST_MENU_ITEM_VISIBLE_REQUIRED MENU_STATE='),
  'a hidden host navigation item must preserve the menu and sidebar geometry needed for root-cause diagnosis');
assert.ok(source.includes('rect.right > 0 && rect.bottom > 0 && rect.top < window.innerHeight')
  && source.includes('centerX >= 0 && centerX <= window.innerWidth'),
  'a visible sidebar item may retain Ant Design indentation beyond the left viewport edge');
assert.ok(source.includes('HOST_AUTHORITY_OUTBOX_EXPAND_REQUIRED'),
  'the host-side advanced sync accordion must be visibly expanded before asserting its authority outbox controls');
assert.ok(source.includes('CLOUD_WORKER_WAKE_NOT_OBSERVED'));
assert.ok(source.includes('REAL_DESKTOP_CDP_ACTION_FAILED'));
assert.ok(source.includes('ACTION='));
assert.ok(source.includes('runLanE2ePreflight'));
assert.ok(source.includes('LAN firewall preflight enabled'));
assert.ok(source.includes('const requiresLanFirewallAudit = !acceptance.websocketDisabled && !acceptance.relayWebSocket;'));
assert.ok(source.includes('requiresLanFirewallAudit && !usesIsolatedTemporaryHostPackage(HOST_EXE)'));
assert.ok(source.includes('[e2e] LAN firewall preflight skipped for relay-only acceptance'));
assert.ok(source.includes('usesIsolatedTemporaryHostPackage') && source.includes('TEMPORARY_PACKAGE_FIREWALL_AUDIT_BYPASSED'),
  'only a named disposable win-unpacked test package may skip an installed-program firewall audit');
assert.ok(source.includes('tmp-e2e-host-[a-z0-9-]+'),
  'the temporary-package firewall exemption must be limited to the dedicated E2E output prefix');
assert.ok(source.includes('tmp-host-acceptance-'),
  'the separately named isolated host acceptance package must not be mistaken for an installed host requiring a user firewall rule');
assert.ok(source.includes('fixedLanHostPort'));
assert.ok(source.includes('GEWU_LAN_E2E_HOST_PORT'));
assert.ok(source.includes('configuredLanHostPort') && source.includes('await freePort()'),
  'a disposable two-desktop run must choose a free host port unless an operator explicitly pins one');
assert.ok(source.includes('function showUsage()'),
  'the real E2E harness must expose a non-destructive help mode');
assert.ok(source.includes("['--help', '-h'].includes(process.argv[2])"),
  'help must be handled before package, network, firewall, or profile preflight');
assert.strictEqual(source.includes("desktopIdentityMode: 'single-user'"), false,
  'the acceptance harness must use the managed full identity architecture, never the retired single-user mode');
assert.ok(source.includes("desktopIdentityMode: 'full'"),
  'the isolated host and client profiles must exercise the managed identity architecture');
assert.ok(source.includes('beginClientIdentityRegistration') && source.includes('approvePendingDeviceThroughHostUi')
  && source.includes('completeClientIdentityRegistration'),
  'the acceptance harness must drive managed registration, host approval, and local-password completion through visible UI');
assert.ok(source.includes('CLIENT_AUTHORITY_UNLOCK_COMPLETED_REQUIRED')
  && source.includes('CLIENT_AUTHORITY_RUNTIME_SHELL_REQUIRED')
  && source.includes('hasRuntimeShell'),
  'a restarted client must not treat the preload authority bridge as proof that its visible local-password unlock has completed');
assert.ok(source.includes("host renderer refreshed before visible device approval"),
  'device approval must reattach a fresh host renderer after the client identity transition');
assert.ok(source.includes('bootstrapHostAuthorityThroughUi')
  && source.includes('HOST_AUTHORITY_BOOTSTRAP_COMPLETE_REQUIRED')
  && source.includes('HOST_RECOVERY_RESTART_REQUIRED'),
  'the primary-host acceptance must create its epoch and acknowledge the recovery delivery through the rendered UI before it observes the worker');
assert.ok(source.includes('/__e2e/approve-latest-bootstrap-host'),
  'the disposable first-host bootstrap must establish its initial control-plane super-admin context');
assert.ok(source.includes('approvePendingDeviceThroughHostUi'),
  'after bootstrap, ordinary-device approval must still be performed through the visible data-host UI, never through the bootstrap endpoint');
assert.ok(source.includes('GEWU_E2E_EXTERNAL_VISIBLE_APPROVAL')
  && source.includes('WAITING_FOR_EXTERNAL_VISIBLE_DEVICE_APPROVAL')
  && source.includes('waitForExternalVisibleDeviceApproval'),
  'a governed run must support pausing for Windows-level visible approval when hidden CDP documents cannot paint AntD navigation');
assert.ok(source.includes("HOST_EXTERNAL_APPROVAL_CONTROL_PLANE_REQUIRED")
  && source.includes("HOST_DEVICE_APPROVED_PENDING_STATUS_REQUIRED"),
  'external visible approval must still prove both the isolated control-plane transition and the rendered approved-pending label');
assert.strictEqual(source.includes('firewall-enable-lan'), false,
  'the E2E harness must audit an existing narrow rule, never trigger elevation');
assert.ok(actionSource.includes('PAGE_TEXT='));
assert.ok(actionSource.includes('buttons: 1') && actionSource.includes('buttons: 0'),
  'the visible-window CDP action helper must preserve pressed and released mouse-button state');
console.log('real two-desktop E2E contract checks passed');
