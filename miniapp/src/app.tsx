/**
 * App startup, permission initialization, and session-bound synchronization.
 */
import { PropsWithChildren } from 'react';
import { useLaunch } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import './app.scss';

let App: React.FC<PropsWithChildren<any>>;

App = function App({ children }: PropsWithChildren<any>) {
  useLaunch((options) => {
    console.log('\u6559\u80b2\u7efc\u5408\u670d\u52a1\u5e73\u53f0 v1.6.0');
    initializeAuthenticatedApp(options).catch(() => {
      if (!isUnauthenticatedEntryPage(options?.path)) {
        Taro.reLaunch({ url: '/pages/login/index' });
      }
    });
  });

  return children;
};

const UNAUTHENTICATED_ENTRY_PAGES = new Set([
  'pages/login/index',
  'pages/desktop-authorization/index',
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
  await initApp(session, authSessionRuntime);
}

async function initApp(startupSession: any, authSessionRuntime: any) {
  const [
    { fetchPermissions },
    { clearBusinessCache, setBusinessCacheIdentity },
    { isUnrecognizedIdentity, isVisitorIdentity },
  ] = await Promise.all([
    import('./utils/permission'),
    import('./utils/storage'),
    import('./utils/accountExperience'),
  ]);

  if (!authSessionRuntime.isSameSession(startupSession)) return;
  const isLimitedIdentity = (identity: any) => (
    isUnrecognizedIdentity(identity) || isVisitorIdentity(identity)
  );
  if (isLimitedIdentity(startupSession.identity)) {
    clearBusinessCache();
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
}

export default App;
