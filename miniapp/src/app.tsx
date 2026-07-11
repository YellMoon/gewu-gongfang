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

    const token = Taro.getStorageSync('auth_token');
    if (token) initApp();
  });

  return children;
};

async function initApp() {
  const [{ fetchPermissions }, { setBusinessCacheIdentity }, syncEngine] = await Promise.all([
    import('./utils/permission'),
    import('./utils/storage'),
    getSyncEngine(),
  ]);

  setBusinessCacheIdentity(Taro.getStorageSync('user_info'));

  try {
    await fetchPermissions();
  } catch (err) {
    console.warn('初始化权限失败:', err);
  }

  // 检查待同步队列
  const pendingCount = syncEngine.getPendingCount();
  if (pendingCount > 0) {
    console.log(`[Sync] 有 ${pendingCount} 条待同步变更`);

    // 尝试自动推送；如果当前离线，请求会失败并保留待同步队列，等网络恢复监听再处理。
    const token = Taro.getStorageSync('auth_token');
    syncEngine.push('', token).then((r) => {
      if (r.success) console.log(`[Sync] 自动推送 ${r.pushed} 条成功`);
    });
  }

  // 监听网络变化
  Taro.onNetworkStatusChange((res) => {
    if (res.isConnected) {
      console.log('[App] 网络已恢复');
      // 自动拉取云端变更
      const token = Taro.getStorageSync('auth_token');
      if (token) {
        getSyncEngine().then((engine) => engine.pull('', token)).then((r) => {
          if (r.success && r.operations.length > 0) {
            console.log(`[Sync] 自动拉取 ${r.operations.length} 条变更`);
          }
        }).catch((err) => {
          console.warn('[Sync] 自动拉取失败:', err);
        });
      }
    } else {
      console.log('[App] 网络已断开，进入离线模式');
    }
  });
}

export { getSyncEngine };
export default App;
