import React, { useEffect, useRef, useState } from 'react';
import { Modal, message } from 'antd';
import { planDesktopAutoSync, sessionTokenFromStore, submitSequentially } from '../services/desktopAutoSync.mjs';

// UTF-8: online edits submit silently; offline drafts ask once; conflicts pause auto-sync.
const DesktopAutoSync: React.FC = () => {
  const [paused, setPaused] = useState(false);
  const dismissedRef = useRef('');
  const runningRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    const refreshProjection = async () => {
      try { await (window as any).dbService?.refreshAuthorityProjection?.({ notifyConsumers: true }); } catch { /* best effort */ }
    };
    const tick = async () => {
      if (stopped || runningRef.current || paused) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const bridge = (window as any).desktopAuthority;
      if (!bridge?.list || !bridge?.confirmAndSubmit) return;
      runningRef.current = true;
      try {
        const items = await bridge.list();
        const plan = planDesktopAutoSync(items);
        if (plan.blocked) { setPaused(true); return; }
        let sessionToken = '';
        try { sessionToken = String(sessionTokenFromStore()); } catch { return; }
        if (plan.onlineIds.length) {
          const outcomes: any[] = await submitSequentially({ bridge, items, ids: plan.onlineIds, sessionToken });
          if (outcomes.some(outcome => outcome.rejected || outcome.error)) { setPaused(true); return; }
          await refreshProjection();
        }
        if (plan.offlineIds.length) {
          const signature = plan.offlineIds.join(',');
          if (dismissedRef.current === signature) return;
          const count = plan.offlineIds.length;
          Modal.confirm({
            title: '提交离线期间的修改',
            content: `本机有 ${count} 条离线修改，是否现在整体提交到云端？`,
            okText: '整体提交',
            cancelText: '稍后再说',
            onOk: async () => {
              const outcomes: any[] = await submitSequentially({ bridge, items, ids: plan.offlineIds, sessionToken });
              if (outcomes.some(outcome => outcome.rejected || outcome.error)) {
                setPaused(true);
                message.error('部分离线修改提交失败，已暂停自动同步，请在同步面板处理');
                return;
              }
              message.success(`已提交 ${outcomes.length} 条离线修改`);
              await refreshProjection();
            },
            onCancel: () => { dismissedRef.current = signature; },
          });
        }
      } catch (_error) {
        // Fail closed: retry on the next tick.
      } finally {
        runningRef.current = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 4000);
    void tick();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [paused]);

  return null;
};

export default DesktopAutoSync;
