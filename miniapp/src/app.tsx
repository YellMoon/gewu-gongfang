/**
 * 应用入口 v2 — 启动初始化 + 网络监听 + 自动同步
 */
import { PropsWithChildren } from 'react';
import { useLaunch } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import './app.scss';

type SyncEngineInstance = import('./utils/syncEngine').MiniSyncEngine;

let syncEnginePromise: Promise<SyncEngineInstance> | null = null;

function getSyncEngine(): Promise<SyncEngineInstance> {
  if (!syncEnginePromise) {
    syncEnginePromise = import('./utils/syncEngine').then(({ MiniSyncEngine }) => new MiniSyncEngine());
  }
  return syncEnginePromise;
}

let App: React.FC<PropsWithChildren<any>>;

App = function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    console.log('教育综合服务平台 v1.6.0');

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
  const [{ fetchPermissions }, { setBusinessCacheIdentity }, { isReviewExperienceIdentity }] = await Promise.all([
    import('./utils/permission'),
    import('./utils/storage'),
    import('./utils/reviewExperience'),
  ]);

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  setBusinessCacheIdentity(startupSession.identity);

  try {
    await fetchPermissions();
  } catch (err) {
    console.warn('初始化权限失败:', err);
  }

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  if (isReviewExperienceIdentity(startupSession.identity)) return;

  const syncEngine = await getSyncEngine();
  if (!authSessionRuntime.isSameSession(startupSession)) return;

  // 检查待同步队列
  const pendingCount = syncEngine.getPendingCount();
  if (pendingCount > 0) {
    console.log(`[Sync] 有 ${pendingCount} 条待同步变更`);

    // 尝试自动推送；如果当前离线，请求会失败并保留待同步队列，等网络恢复监听再处理。
    const session = captureTrustedAuthSession(authSessionRuntime);
    if (!session) return;
    syncEngine.push('', session.token).then((r) => {
      if (r.success) console.log(`[Sync] 自动推送 ${r.pushed} 条成功`);
    });
  }

  // 监听网络变化
  Taro.onNetworkStatusChange((res) => {
    if (res.isConnected) {
      console.log('[App] 网络已恢复');
      // 自动拉取云端变更
      const session = captureTrustedAuthSession(authSessionRuntime);
      if (session) {
        getSyncEngine().then((engine) => engine.pull('', session.token)).then((r) => {
          if (r.success && r.operations.length > 0) {
            console.log(`[Sync] 自动拉取 ${r.operations.length} 条变更`);
          }
        }).catch((err) => {
          console.warn('[Sync] 自动拉取失败:', err);
        });
      } else {
        Taro.reLaunch({ url: '/pages/login/index' });
      }
    } else {
      console.log('[App] 网络已断开，进入离线模式');
    }
  });
}

export { getSyncEngine };
export default App;
