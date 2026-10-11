import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import { planDesktopAutoSync, sessionTokenFromStore } from '../services/desktopAutoSync.mjs';
import { desktopCloudTransportUnavailable } from '../services/desktopIdentityClient.mjs';
import { createDesktopSyncController } from '../services/desktopSyncController.mjs';
import { describePendingChanges } from '../services/desktopSyncReview.mjs';
import { hasPendingQuestionAssetVerification, refreshQuestionAssetVerification, relayQuestionAssetsAfterReceipt } from '../services/desktopQuestionAssetRelay';
import { PendingChangesPanel } from './AuthorityOutboxPanel';
import './sync/DesktopSync.css';
import { discardCancelledQuestionImportDrafts } from '../services/cancelledQuestionImportDrafts.mjs';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
const { createDesktopQuestionImportClient } = require('../services/desktopQuestionImportClient.mjs');

const DesktopAutoSync: React.FC = () => {
  const controllerRef = useRef<any>(null);
  const [state, setState] = useState<any>({ items: [], descriptions: {}, open: false, busy: false, online: true, error: '' });
  useEffect(() => {
    const bridge = (window as any).desktopAuthority;
    if (!bridge?.list || !bridge?.confirmAndSubmit) return;
    let active = true;
    let tickPromise: Promise<void> | null = null;
    const sessionAvailable = () => {
      try { return Boolean(sessionTokenFromStore()); } catch { return false; }
    };
    const refreshProjection = (options = { businessOnly: true }) => (window as any).dbService?.refreshAuthorityProjection?.({ ...options, notifyConsumers: true });
    const controller = createDesktopSyncController({
      bridge, sessionToken: sessionTokenFromStore,
      isOnline: () => navigator.onLine !== false && !desktopCloudTransportUnavailable() && sessionAvailable(),
      refreshProjection,
      describe: (items: any[]) => describePendingChanges(items, (window as any).dbService?.data || {},
        () => (window as any).desktopIdentitySessionProvider?.listCloudBusinessProjection?.()),
      pendingAssets: hasPendingQuestionAssetVerification,
      afterCommit: relayQuestionAssetsAfterReceipt,
      checkAssets: refreshQuestionAssetVerification,
      pruneCancelledImports: async (items: any[], active: () => boolean) => {
        if (!items.some(item => item.type === 'question.create.v1' && item.payload?.record?.import_task_id && item.status !== 'completed')) return;
        const client = createDesktopQuestionImportClient(await getRuntimeConfig(), { parse: async () => {} });
        await discardCancelledQuestionImportDrafts({ items, bridge, readTask: client.read, active });
      },
    });
    const unsubscribe = controller.subscribe(setState);
    const tick = () => {
      if (!active) return Promise.resolve();
      if (tickPromise) return tickPromise;
      tickPromise = (async () => {
        if (navigator.onLine !== false && (desktopCloudTransportUnavailable() || !sessionAvailable())) {
          try { await (window as any).desktopIdentitySessionProvider?.ensureOnline?.(); } catch { /* Keep offline drafts unconfirmed. */ }
        }
        if (active) await controller.tick();
      })().finally(() => { tickPromise = null; });
      return tickPromise;
    };
    controllerRef.current = { ...controller, tick };
    const open = () => { void controller.open(); };
    const reconnect = () => { void tick().then(() => { if (active && sessionAvailable()) return refreshProjection(); }).catch(() => {}); };
    const timer = window.setInterval(tick, 4000);
    window.addEventListener('desktop-sync-open', open);
    window.addEventListener('desktop-authority-drafts-changed', tick);
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', tick);
    tick();
    return () => {
      active = false;
      controller.stop(); unsubscribe(); controllerRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener('desktop-sync-open', open);
      window.removeEventListener('desktop-authority-drafts-changed', tick);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', tick);
    };
  }, []);
  const blocked = state.items.some((item: any) => item.status === 'conflict' || state.descriptions[item.id]?.blocked);
  const confirmationIds = planDesktopAutoSync(state.items).offlineIds;
  return <Modal title={'\u4e91\u540c\u6b65'} open={state.open} width="min(760px, calc(100vw - 32px))"
    className="desktop-sync-dialog" onCancel={() => controllerRef.current?.close()}
    maskClosable={!state.busy} closable={!state.busy} keyboard={!state.busy} destroyOnHidden
    footer={[
      <Button key="refresh" disabled={state.busy} onClick={() => controllerRef.current?.tick()}>{'\u5237\u65b0'}</Button>,
      <Button key="close" disabled={state.busy} onClick={() => controllerRef.current?.close()}>{state.items.length ? '\u7a0d\u540e\u518d\u8bf4' : '\u5173\u95ed'}</Button>,
      confirmationIds.length > 0 && <Button key="confirm" type="primary" loading={state.busy} disabled={!state.online || blocked}
        onClick={() => controllerRef.current?.confirm(state.items)}>{'\u786e\u8ba4\u5e76\u6279\u91cf\u63d0\u4ea4'} ({confirmationIds.length})</Button>,
    ]}>
    <PendingChangesPanel state={state} onDiscard={id => { void controllerRef.current?.discard(id); }} />
  </Modal>;
};
export default DesktopAutoSync;
