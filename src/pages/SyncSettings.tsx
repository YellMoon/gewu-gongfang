import React from 'react';
import AuthorityOutboxPanel from '../components/AuthorityOutboxPanel';
import type { CloudSyncContext } from '../navigation/navigationContext';

interface SyncSettingsProps {
  context?: CloudSyncContext;
  variant?: 'quick' | 'advanced';
  onNavigateToSettings?: (mode?: 'issues' | 'pending') => void;
}

const SyncSettings: React.FC<SyncSettingsProps> = ({ context, variant = 'advanced' }) => (
  <AuthorityOutboxPanel compact={variant === 'quick'} focus={context?.mode} />
);

export default SyncSettings;
