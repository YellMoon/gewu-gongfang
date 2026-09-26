import React, { useCallback, useEffect, useState } from 'react';
import { Button, Popover } from 'antd';
import { CloudSyncOutlined } from '@ant-design/icons';
import SyncSettings from '../../pages/SyncSettings';
import { getSyncPresentation } from '../../services/syncPresentation.mjs';
import type { NavigationInput } from '../../navigation/navigationContext';
import './SyncQuickPanel.css';

type Props = {
  onNavigate: (page: NavigationInput) => void;
};

const SyncQuickPanel: React.FC<Props> = ({ onNavigate }) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({ online: true, pendingCount: 0, conflictCount: 0 });

  const refresh = useCallback(async () => {
    try {
      if (!window.desktopAuthority) throw new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE');
      const items = await window.desktopAuthority.list();
      setStatus({
        online: true,
        pendingCount: items.filter(item => item.status !== 'completed').length,
        conflictCount: items.filter(item => item.status === 'conflict').length,
      });
    } catch {
      setStatus(current => ({ ...current, online: false }));
    }
  }, []);

  useEffect(() => {
    // UTF-8: no background polling; refresh on mount, on demand, and when the popover opens.
    void refresh();
    window.addEventListener('authority-projection-refreshed', refresh);
    return () => window.removeEventListener('authority-projection-refreshed', refresh);
  }, [refresh]);

  const presentation = getSyncPresentation(status);
  const navigateToSettings = (mode?: 'issues' | 'pending') => {
    setOpen(false);
    onNavigate({
      page: 'system-params',
      context: { mode, section: 'sync-settings' },
    });
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={next => { setOpen(next); if (next) void refresh(); }}
      placement="bottomLeft"
      overlayClassName="sync-quick-popover"
      content={<SyncSettings variant="quick" onNavigateToSettings={navigateToSettings} />}
    >
      <Button className={`sync-status-trigger sync-status-trigger--${presentation.tone}`} type="text" size="small" icon={<CloudSyncOutlined />}>
        {presentation.statusText}
      </Button>
    </Popover>
  );
};

export default SyncQuickPanel;
