/**
 * App startup, permission initialization, and session-bound synchronization.
 */
import { PropsWithChildren } from 'react';
import { useLaunch } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import './app.scss';

type SyncEngineInstance = import('./utils/syncEngine').MiniSyncEngine;

let syncEnginePromise: Promise<SyncEngineInstance> | null = null;
let disposeNetworkSyncListener: (() => void) | null = null;

function getSyncEngine(): Promise<SyncEngineInstance> {
  if (!syncEnginePromise) {
    syncEnginePromise = import('./utils/syncEngine').then(({ MiniSyncEngine }) => new MiniSyncEngine());
  }
  return syncEnginePromise;
}

let App: React.FC<PropsWithChildren<any>>;

App = function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    console.log('\u6559\u80b2\u7efc\u5408\u670d\u52a1\u5e73\u53f0 v1.6.0');
    initializeAuthenticatedApp().catch(() => Taro.reLaunch({ url: '/pages/login/index' }));
  });

  return children;
};

async function initializeAuthenticatedApp() {
  const [{ authSessionRuntime }, { captureTrustedAuthSession }] = await Promise.all([
    import('./utils/authSession'),
    import('./utils/miniappApiSessionRuntime'),
  ]);
  const session = captureTrustedAuthSession(authSessionRuntime);
  if (!session) {
    Taro.reLaunch({ url: '/pages/login/index' });
    return;
  }
  await initApp(session, authSessionRuntime, captureTrustedAuthSession);
}

async function initApp(startupSession: any, authSessionRuntime: any, captureTrustedAuthSession: any) {
  disposeNetworkSyncListener?.();
  disposeNetworkSyncListener = null;

  const [
    { fetchPermissions },
    { setBusinessCacheIdentity },
    { isReviewExperienceIdentity },
    { createSessionBoundNetworkSyncListener },
  ] = await Promise.all([
    import('./utils/permission'),
    import('./utils/storage'),
    import('./utils/reviewExperience'),
    import('./utils/miniappStartupSyncRuntime'),
  ]);

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  setBusinessCacheIdentity(startupSession.identity);

  try {
    await fetchPermissions();
  } catch (err) {
    console.warn('\u521d\u59cb\u5316\u6743\u9650\u5931\u8d25:', err);
  }

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  if (isReviewExperienceIdentity(startupSession.identity)) return;

  const syncEngine = await getSyncEngine();
  if (!authSessionRuntime.isSameSession(startupSession)) return;

  const pendingCount = syncEngine.getPendingCount();
  if (pendingCount > 0) {
    console.log(`[Sync] \u6709 ${pendingCount} \u6761\u5f85\u540c\u6b65\u53d8\u66f4`);
    const session = captureTrustedAuthSession(authSessionRuntime);
    if (!session
      || !authSessionRuntime.isSameSession(startupSession)
      || isReviewExperienceIdentity(session.identity)) return;
    syncEngine.push('', session.token).then((result) => {
      if (result.success) console.log(`[Sync] \u81ea\u52a8\u63a8\u9001 ${result.pushed} \u6761\u6210\u529f`);
    });
  }

  disposeNetworkSyncListener = createSessionBoundNetworkSyncListener({
    startupSession,
    isSameSession: (session: any) => authSessionRuntime.isSameSession(session),
    captureTrustedAuthSession: () => captureTrustedAuthSession(authSessionRuntime),
    isReviewExperienceIdentity,
    onNetworkStatusChange: (listener: any) => Taro.onNetworkStatusChange(listener),
    offNetworkStatusChange: (listener: any) => (Taro as any).offNetworkStatusChange?.(listener),
    pull: (token: string) => syncEngine.pull('', token),
    onConnected: () => console.log('[App] \u7f51\u7edc\u5df2\u6062\u590d'),
    onDisconnected: () => console.log('[App] \u7f51\u7edc\u5df2\u65ad\u5f00\uff0c\u8fdb\u5165\u79bb\u7ebf\u6a21\u5f0f'),
    onMissingSession: () => Taro.reLaunch({ url: '/pages/login/index' }),
    onPullSuccess: (result: any) => {
      if (result.success && result.operations.length > 0) {
        console.log(`[Sync] \u81ea\u52a8\u62c9\u53d6 ${result.operations.length} \u6761\u53d8\u66f4`);
      }
    },
    onPullFailure: (err: any) => console.warn('[Sync] \u81ea\u52a8\u62c9\u53d6\u5931\u8d25:', err),
  });
}

export { getSyncEngine };
export default App;
