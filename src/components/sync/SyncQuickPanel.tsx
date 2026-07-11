import React, { useEffect, useMemo, useState } from 'react';
import { Button, Popover } from 'antd';
import { CloudSyncOutlined } from '@ant-design/icons';
import SyncSettings from '../../pages/SyncSettings';
import { SyncEngine } from '../../services/syncEngine';
import { getRuntimeConfig } from '../../services/runtimeConfigClient';
import { getSyncPresentation } from '../../services/syncPresentation.mjs';
import type { NavigationInput } from '../../navigation/navigationContext';
import './SyncQuickPanel.css';

type Props = {
  onNavigate: (page: NavigationInput) => void;
};

const SyncQuickPanel: React.FC<Props> = ({ onNavigate }) => {
  const [open, setOpen] = useState(false);
  const [nodeRole, setNodeRole] = useState('desktop-client');
  const [status, setStatus] = useState({ online: true, pendingCount: 0 });
  const engine = useMemo(() => {
    try {
      return new SyncEngine();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    getRuntimeConfig().then(config => setNodeRole(config.nodeRole || 'desktop-client')).catch(() => undefined);
    const refresh = () => {
      if (engine) setStatus(engine.getStatus());
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [engine]);

  const presentation = getSyncPresentation(nodeRole, status);
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
