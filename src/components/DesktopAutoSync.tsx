import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import { sessionTokenFromStore } from '../services/desktopAutoSync.mjs';
import { createDesktopSyncController } from '../services/desktopSyncController.mjs';
import { describePendingChanges } from '../services/desktopSyncReview.mjs';
import { hasPendingQuestionAssetVerification, refreshQuestionAssetVerification, relayQuestionAssetsAfterReceipt } from '../services/desktopQuestionAssetRelay';
import { PendingChangesPanel } from './AuthorityOutboxPanel';
import './sync/DesktopSync.css';

const DesktopAutoSync: React.FC = () => {
  const controllerRef = useRef<any>(null);
  const [state, setState] = useState<any>({ items: [], descriptions: {}, open: false, busy: false, online: true, error: '' });
  useEffect(() => {
    const bridge = (window as any).desktopAuthority;
    if (!bridge?.list || !bridge?.confirmAndSubmit) return;
    const refreshProjection = (options = { businessOnly: true }) => (window as any).dbService?.refreshAuthorityProjection?.({ ...options, notifyConsumers: true });
    const controller = createDesktopSyncController({
      bridge, sessionToken: sessionTokenFromStore, isOnline: () => navigator.onLine !== false,
      refreshProjection,
      describe: (items: any[]) => describePendingChanges(items, (window as any).dbService?.data || {},
        () => (window as any).desktopIdentitySessionProvider?.listCloudBusinessProjection?.()),
      pendingAssets: hasPendingQuestionAssetVerification,
      afterCommit: relayQuestionAssetsAfterReceipt,
      checkAssets: refreshQuestionAssetVerification,
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setState);
    const tick = () => { void controller.tick(); };
    const open = () => { void controller.open(); };
    const reconnect = () => { void Promise.resolve().then(() => refreshProjection()).catch(() => {}).finally(tick); };
    const timer = window.setInterval(tick, 4000);
    window.addEventListener('desktop-sync-open', open);
    window.addEventListener('desktop-authority-drafts-changed', tick);
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', tick);
    tick();
    return () => {
      controller.stop(); unsubscribe(); controllerRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener('desktop-sync-open', open);
      window.removeEventListener('desktop-authority-drafts-changed', tick);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', tick);
    };
  }, []);
  const blocked = state.items.some((item: any) => item.status === 'conflict' || state.descriptions[item.id]?.blocked);
  return <Modal title={'\u4e91\u540c\u6b65'} open={state.open} width="min(760px, calc(100vw - 32px))"
    className="desktop-sync-dialog" onCancel={() => controllerRef.current?.close()}
    maskClosable={!state.busy} closable={!state.busy} keyboard={!state.busy} destroyOnHidden
    footer={[
      <Button key="refresh" disabled={state.busy} onClick={() => controllerRef.current?.tick()}>{'\u5237\u65b0'}</Button>,
      <Button key="close" disabled={state.busy} onClick={() => controllerRef.current?.close()}>{state.items.length ? '\u7a0d\u540e\u518d\u8bf4' : '\u5173\u95ed'}</Button>,
      state.items.length > 0 && <Button key="confirm" type="primary" loading={state.busy} disabled={!state.online || blocked}
        onClick={() => controllerRef.current?.confirm(state.items)}>{'\u786e\u8ba4\u5e76\u6279\u91cf\u63d0\u4ea4'} ({state.items.length})</Button>,
    ]}>
    <PendingChangesPanel state={state} onDiscard={id => { void controllerRef.current?.discard(id); }} />
  </Modal>;
};
export default DesktopAutoSync;
