/**
 * App startup, permission initialization, and session-bound synchronization.
 */
import { PropsWithChildren } from 'react';
import { useDidShow, useLaunch } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import miniappPackage from '../package.json';
import { questionBasketStore } from './utils/questionBasketStore';
import './app.scss';

let App: React.FC<PropsWithChildren<any>>;

declare const __APP_VERSION__: string | undefined;

const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
  ? __APP_VERSION__.trim()
  : miniappPackage.version;

App = function App({ children }: PropsWithChildren<any>) {
  useLaunch((options) => {
    questionBasketStore.reconcileIdentity();
    console.info(`\u683c\u7269\u5de5\u574a v${APP_VERSION}`);
    initializeAuthenticatedApp(options).catch(() => {
      if (!isUnauthenticatedEntryPage(options?.path)) {
        Taro.reLaunch({ url: '/pages/login/index' });
      }
    });
  });

  useDidShow(() => {
    questionBasketStore.reconcileIdentity();
  });

  return children;
};

const UNAUTHENTICATED_ENTRY_PAGES = new Set([
  'pages/login/index',
  'pages/login/privacy',
]);

export function isUnauthenticatedEntryPage(path?: string): boolean {
  return UNAUTHENTICATED_ENTRY_PAGES.has(String(path || '').replace(/^\//, '').split('?')[0]);
}

async function initializeAuthenticatedApp(launchOptions: any = {}) {
  if (isUnauthenticatedEntryPage(launchOptions.path)) return;
  const [{ authSessionRuntime }, { captureTrustedAuthSession }] = await Promise.all([
    import('./utils/authSession'),
    import('./utils/miniappApiSessionRuntime'),
  ]);
  const session = captureTrustedAuthSession(authSessionRuntime);
  if (!session) {
    Taro.reLaunch({ url: '/pages/login/index' });
    return;
  }
  await initApp(session, authSessionRuntime, launchOptions.path);
}

async function initApp(startupSession: any, authSessionRuntime: any, launchPath = '') {
  const [
    { fetchPermissions, getEffectiveMiniappAccess },
    { clearBusinessCache, setBusinessCacheIdentity },
    { isVisitorIdentity },
    { canOpenMiniappRoute },
  ] = await Promise.all([
    import('./utils/permission'),
    import('./utils/storage'),
    import('./utils/accountExperience'),
    import('./utils/miniappRouteAccess'),
  ]);

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  const isLimitedIdentity = (identity: any) => isVisitorIdentity(identity);
  if (isLimitedIdentity(startupSession.identity)) {
    clearBusinessCache();
    if (!canOpenMiniappRoute(launchPath, getEffectiveMiniappAccess(startupSession.identity))) {
      Taro.reLaunch({ url: '/pages/forbidden/index' });
    }
    return;
  }
  setBusinessCacheIdentity(startupSession.identity);

  try {
    await fetchPermissions();
  } catch (err) {
    console.warn('\u521d\u59cb\u5316\u6743\u9650\u5931\u8d25:', err);
  }

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  if (isLimitedIdentity(startupSession.identity)) return;
  if (!canOpenMiniappRoute(launchPath, getEffectiveMiniappAccess(startupSession.identity))) {
    Taro.reLaunch({ url: '/pages/forbidden/index' });
  }
}

export default App;
