import React, { useCallback, useEffect, useState } from 'react';
import { Button } from 'antd';
import { CloudSyncOutlined } from '@ant-design/icons';
import { openDesktopSync } from '../AuthorityOutboxPanel';
import { getSyncPresentation } from '../../services/syncPresentation.mjs';
import type { NavigationInput } from '../../navigation/navigationContext';
import './SyncQuickPanel.css';

type Props = {
  onNavigate: (page: NavigationInput) => void;
};

const SyncQuickPanel: React.FC<Props> = ({ onNavigate }) => {
  const [status, setStatus] = useState({ online: true, pendingCount: 0, conflictCount: 0 });

  const refresh = useCallback(async () => {
    try {
      if (!window.desktopAuthority) throw new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE');
      const items = await window.desktopAuthority.list();
      setStatus({
        online: navigator.onLine !== false,
        pendingCount: items.filter(item => item.status !== 'completed').length,
        conflictCount: items.filter(item => item.status === 'conflict').length,
      });
    } catch {
      setStatus(current => ({ ...current, online: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const events = ['authority-projection-refreshed', 'desktop-authority-drafts-changed', 'online', 'offline'];
    events.forEach(event => window.addEventListener(event, refresh));
    return () => events.forEach(event => window.removeEventListener(event, refresh));
  }, [refresh]);

  const presentation = getSyncPresentation(status);

  return (
      <Button onClick={openDesktopSync} title={presentation.statusText} className={`sync-status-trigger sync-status-trigger--${presentation.tone}`} type="text" size="small" icon={<CloudSyncOutlined />}>
        {'\u4e91\u540c\u6b65'}{status.pendingCount > 0 ? ` (${status.pendingCount})` : ''}
      </Button>
  );
};

export default SyncQuickPanel;
