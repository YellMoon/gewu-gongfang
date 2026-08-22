import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        if (!window.desktopAuthority) throw new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE');
        const items = await window.desktopAuthority.list();
        if (!stopped) setStatus({
          online: true,
          pendingCount: items.filter(item => item.status !== 'completed').length,
          conflictCount: items.filter(item => item.status === 'conflict').length,
        });
      } catch {
        if (!stopped) setStatus(current => ({ ...current, online: false }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

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
      onOpenChange={setOpen}
      placement="bottomRight"
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
