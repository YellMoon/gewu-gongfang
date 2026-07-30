import React, { useEffect, useState } from 'react';
import { Alert, Card, Button, message, Space, Divider, Popconfirm, Typography, Table, Tag, Form, Input, Select, Progress, Collapse, Descriptions } from 'antd';
import { CloudDownloadOutlined, CloudSyncOutlined, ExportOutlined, ImportOutlined, DeleteOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { APP_VERSION } from '../generated/version';
import {
  getRuntimeConfig,
  saveRuntimeConfig,
  selectFolder,
  type RuntimeConfig,
} from '../services/runtimeConfigClient';
import SyncSettings from './SyncSettings';
import HostAuthorityExecutionMonitor from '../components/HostAuthorityExecutionMonitor';
import type { CloudSyncContext } from '../navigation/navigationContext';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { systemSettingsRolePolicy } from '../services/systemSettingsRolePolicy.mjs';
import { authoritySyncSurfacePolicy } from '../services/authoritySyncSurfacePolicy.mjs';
import {
  desktopUpdateStateAfterCheck,
  desktopUpdateErrorMessage,
  invokeDesktopUpdateCheck,
} from '../services/desktopUpdateClient.mjs';
const { questionBankBindingPresentation, bindQuestionBankStore } = require('../services/questionBankBindingUi');

const { Text } = Typography;

type BackupJob = {
  id: string;
  status: string;
  affectedRows: number;
  artifactPath?: string;
  ossUrl?: string;
  scheduleCron?: string;
  retentionDays?: number;
  createdAt: string;
  finishedAt?: string;
  restoredAt?: string;
};

type QuestionBankStorageStatus = {
  configured?: boolean;
  available?: boolean;
  writable?: boolean;
  root?: string;
  configuredRoot?: string;
  pathChanged?: boolean;
  nodeRole?: string;
  reason?: string;
  detail?: string;
  manifest?: {
    storeId?: string;
    schemaVersion?: number;
    lastMountedByDeviceId?: string;
    lastVerifiedAt?: string;
  };
  candidateRoots?: string[];
  binding?: { store_id: string; db_authority_id: string; root_path: string; bound_by: string; bound_at: string; status: string } | null;
};

type BackupTargetStatus = {
  localCache?: {
    available?: boolean;
    status?: string;
    path?: string;
    reason?: string;
  };
  nasBackup?: {
    available?: boolean;
    status?: string;
    path?: string;
    reason?: string;
  };
};

type DesktopUpdateState = {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number;
  latestVersion?: string;
  feedUrl?: string;
  error?: string;
};

type WindowsHostFirewallStatus = {
  state: string;
  code?: string | null;
  managed?: boolean;
  localPort?: number;
};

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001/api';
const QUESTION_BANK_STORAGE_STATUS_PATH = '/api/question-bank/storage/status';
const apiOrigin = API_BASE.replace(/\/api\/?$/, '');

const SystemSettings: React.FC<{ context?: CloudSyncContext }> = ({ context }) => {
  const dbService = (window as any).dbService;
  const [runtimeForm] = Form.useForm<RuntimeConfig>();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [questionBankStorageStatus, setQuestionBankStorageStatus] = useState<QuestionBankStorageStatus | null>(null);
  const [questionBankStorageLoading, setQuestionBankStorageLoading] = useState(false);
  const [backupTargetStatus, setBackupTargetStatus] = useState<BackupTargetStatus | null>(null);
  const [backupJobs, setBackupJobs] = useState<BackupJob[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState>({
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: 0,
  });
  const [windowsHostFirewallStatus, setWindowsHostFirewallStatus] = useState<WindowsHostFirewallStatus | null>(null);
  const [windowsHostFirewallLoading, setWindowsHostFirewallLoading] = useState(false);

  const loadBackupJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/backups?limit=20`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '加载备份任务失败');
      setBackupJobs(json.jobs || []);
    } catch (error: any) {
      message.warning(error.message || '备份任务暂不可用');
    }
  };

  useEffect(() => {
    getRuntimeConfig().then(config => {
      setRuntimeConfig(config);
      runtimeForm.setFieldsValue(config);
      const policy = systemSettingsRolePolicy(config.nodeRole);
      if (policy.loadBackupJobs) loadBackupJobs();
      if (policy.loadQuestionBankStorage) loadQuestionBankStorageStatus();
      if (policy.loadBackupTargets) loadBackupTargetStatus();
    }).catch((error: any) => message.warning(error.message || '\u8fd0\u884c\u914d\u7f6e\u6682\u4e0d\u53ef\u7528'));
  }, []);

  useEffect(() => {
    if (context?.section !== 'sync-settings') return;
    window.setTimeout(() => document.getElementById('sync-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [context]);

  useEffect(() => {
    const api = window.api;
    if (!api?.on) return undefined;
    const offAvailable = api.on('update-available', (info: any) => {
      setDesktopUpdate(prev => ({
        ...prev,
        checking: false,
        available: true,
        latestVersion: info?.version || prev.latestVersion,
        error: undefined,
      }));
    });
    const offNotAvailable = api.on('update-not-available', () => {
      setDesktopUpdate(prev => ({
        ...prev,
        checking: false,
        available: false,
        downloading: false,
        downloaded: false,
        progress: 0,
        error: undefined,
      }));
      message.success('当前已经是最新版本');
    });
    const offProgress = api.on('download-progress', (progress: any) => {
      setDesktopUpdate(prev => ({
        ...prev,
        downloading: true,
        progress: Math.round(Number(progress?.percent || 0)),
      }));
    });
    const offDownloaded = api.on('update-downloaded', () => {
      setDesktopUpdate(prev => ({
        ...prev,
        downloading: false,
        downloaded: true,
        progress: 100,
      }));
      message.success('更新已下载完成，可重启安装');
    });
    const offError = api.on('update-error', (error: any) => {
      setDesktopUpdate(prev => ({
        ...prev,
        checking: false,
        downloading: false,
        error: String(error || '更新失败'),
      }));
    });
    return () => {
      offAvailable();
      offNotAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
  }, []);

  const loadRuntimeConfig = async () => {
    try {
      const config = await getRuntimeConfig();
      setRuntimeConfig(config);
      runtimeForm.setFieldsValue(config);
    } catch (error: any) {
      message.warning(error.message || '运行配置暂不可用');
    }
  };

  const loadWindowsHostFirewallStatus = async () => {
    const primaryHostRuntime = (window as any).primaryHostRuntime;
    if (!primaryHostRuntime?.firewallStatus) return;
    setWindowsHostFirewallLoading(true);
    try {
      setWindowsHostFirewallStatus(await primaryHostRuntime.firewallStatus());
    } catch (error: any) {
      setWindowsHostFirewallStatus({ state: 'error', code: error?.code || 'WINDOWS_FIREWALL_AUDIT_FAILED' });
    } finally {
      setWindowsHostFirewallLoading(false);
    }
  };

  const requestWindowsHostLanFirewall = async () => {
    const primaryHostRuntime = (window as any).primaryHostRuntime;
    if (!primaryHostRuntime?.enableLanFirewall) return;
    setWindowsHostFirewallLoading(true);
    try {
      const result = await primaryHostRuntime.enableLanFirewall();
      setWindowsHostFirewallStatus(result);
      if (result?.state === 'elevation-requested') {
        message.info('\u5df2\u8bf7\u6c42 Windows \u7ba1\u7406\u5458\u6388\u6743\uff0c\u5b8c\u6210\u540e\u53ef\u70b9\u51fb\u68c0\u67e5\u72b6\u6001\u3002\u4e91\u4e2d\u7ee7\u4ecd\u53ef\u6b63\u5e38\u4f7f\u7528\u3002');
      } else {
        message.warning(result?.code || '\u672a\u5b8c\u6210\u5c40\u57df\u7f51\u76f4\u8fde\u6388\u6743\uff0c\u5c06\u7ee7\u7eed\u4f7f\u7528\u4e91\u4e2d\u7ee7\u3002');
      }
    } catch (error: any) {
      message.error(error?.message || '\u5c40\u57df\u7f51\u76f4\u8fde\u6388\u6743\u672a\u5b8c\u6210\uff0c\u4e91\u4e2d\u7ee7\u4ecd\u53ef\u6b63\u5e38\u4f7f\u7528\u3002');
    } finally {
      setWindowsHostFirewallLoading(false);
    }
  };

  useEffect(() => {
    if (runtimeConfig?.nodeRole === 'primary-host') void loadWindowsHostFirewallStatus();
  }, [runtimeConfig?.nodeRole]);

  const handleSaveRuntimeConfig = async () => {
    setRuntimeLoading(true);
    try {
      const values = await runtimeForm.validateFields();
      const {
        nodeRole: _managedNodeRole,
        primaryHostEpochId: _managedEpochId,
        primaryHostGeneration: _managedGeneration,
        ...editableValues
      } = values;
      const saved = await saveRuntimeConfig(editableValues);
      setRuntimeConfig(saved);
      runtimeForm.setFieldsValue(saved);
      message.success('数据主机与同步配置已保存，重启软件后生效');
    } catch (error: any) {
      message.error(error.message || '保存运行配置失败');
    } finally {
      setRuntimeLoading(false);
    }
  };

  const selectMainDbFolder = async () => {
    const folder = await selectFolder();
    if (folder) runtimeForm.setFieldValue('mainDbPath', `${folder}\\scheduling.db`);
  };

  const selectQuestionBankFolder = async () => {
    const folder = await selectFolder();
    if (folder) {
      runtimeForm.setFieldValue('questionBankPath', folder);
      runtimeForm.setFieldValue('questionAssetPath', `${folder}\\assets`);
      runtimeForm.setFieldValue('questionBankCandidatePaths', [folder]);
    }
  };

  const selectLocalCacheFolder = async () => {
    const folder = await selectFolder();
    if (folder) runtimeForm.setFieldValue('localCachePath', folder);
  };

  const selectNasBackupFolder = async () => {
    const folder = await selectFolder();
    if (folder) runtimeForm.setFieldValue('nasBackupPath', folder);
  };

  const loadQuestionBankStorageStatus = async () => {
    setQuestionBankStorageLoading(true);
    try {
      const res = await fetch(`${apiOrigin}${QUESTION_BANK_STORAGE_STATUS_PATH}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '加载题库盘状态失败');
      setQuestionBankStorageStatus(data.status || null);
      const storeId = data.status?.manifest?.storeId;
      if (storeId) runtimeForm.setFieldValue('questionBankStoreId', storeId);
    } catch (error: any) {
      setQuestionBankStorageStatus({
        available: false,
        writable: false,
        reason: error.message || '题库盘状态暂不可用',
      });
    } finally {
      setQuestionBankStorageLoading(false);
    }
  };

  const bindCurrentQuestionBankStore = async () => {
    if (!questionBankStorageStatus?.root) return;
    setQuestionBankStorageLoading(true);
    try {
      const session = readDesktopAuthorizationSession();
      const data = await bindQuestionBankStore(fetch, `${apiOrigin}/api/question-bank/storage/bind`, questionBankStorageStatus, session);
      setQuestionBankStorageStatus(data.status);
      message.success('Question bank store bound');
    } catch (error: any) { message.error(error.message || 'QUESTION_BANK_BIND_FAILED'); }
    finally { setQuestionBankStorageLoading(false); }
  };

  const loadBackupTargetStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/backups/targets/status`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '备份目标状态加载失败');
      setBackupTargetStatus(data.targets || null);
    } catch (error: any) {
      setBackupTargetStatus({
        localCache: { available: false, status: 'offline', reason: error.message || '本机缓存状态不可用' },
        nasBackup: { available: false, status: 'offline', reason: error.message || 'NAS 备份状态不可用' },
      });
    }
  };

  const renderBackupTargetTag = (target?: BackupTargetStatus['localCache']) => {
    if (!target) return <Tag>未检测</Tag>;
    if (target.status === 'not-configured') return <Tag>未配置</Tag>;
    return <Tag color={target.available ? 'green' : 'red'}>{target.available ? '在线' : '离线'}</Tag>;
  };

  const handleCreateServerBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch(`${API_BASE}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: 30, scheduleCron: 'manual' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '创建备份失败');
      message.success('服务端快照已完成');
      await loadBackupJobs();
    } catch (error: any) {
      message.error(error.message || '创建备份失败');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadBackup = (id: string) => {
    window.open(`${API_BASE}/backups/${id}/download`, '_blank');
  };

  const handleRestoreBackup = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/backups/${id}/restore`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '恢复失败');
      message.success(`恢复完成，导入 ${json.result?.total || 0} 条数据`);
      await loadBackupJobs();
    } catch (error: any) {
      message.error(error.message || '恢复失败');
    }
  };

  const handleCheckDesktopUpdate = async () => {
    if (!window.api?.invoke) {
      message.error('\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u8f6f\u4ef6\u5185\u66f4\u65b0');
      return;
    }
    setDesktopUpdate(prev => ({ ...prev, checking: true, error: undefined }));
    try {
      const result = await invokeDesktopUpdateCheck(window.api);
      if (!result?.success) {
        const safeError = result?.error || desktopUpdateErrorMessage(result, 'check');
        setDesktopUpdate(prev => ({ ...prev, checking: false, error: safeError }));
        message.error(safeError);
        return;
      }
      setDesktopUpdate(prev => desktopUpdateStateAfterCheck(prev, result));
    } catch (error: any) {
      const safeError = desktopUpdateErrorMessage(error, 'check');
      setDesktopUpdate(prev => ({ ...prev, checking: false, error: safeError }));
      message.error(safeError);
    }
  };

  const handleDownloadDesktopUpdate = async () => {
    setDesktopUpdate(prev => ({ ...prev, downloading: true, error: undefined }));
    try {
      const result = await window.api?.invoke('download-update');
      if (!result?.success) {
        const safeError = result?.error || desktopUpdateErrorMessage(result, 'download');
        setDesktopUpdate(prev => ({ ...prev, downloading: false, error: safeError }));
        message.error(safeError);
      }
    } catch (error: any) {
      const safeError = desktopUpdateErrorMessage(error, 'download');
      setDesktopUpdate(prev => ({ ...prev, downloading: false, error: safeError }));
      message.error(safeError);
    }
  };

  const handleInstallDesktopUpdate = async () => {
    try {
      const result = await window.api?.invoke('install-update');
      if (!result?.success) message.error(result?.error || desktopUpdateErrorMessage(result, 'install'));
    } catch (error: any) {
      message.error(desktopUpdateErrorMessage(error, 'install'));
    }
  };
  const renderDesktopUpdatePanel = () => (
    <Card title={'\u8f6f\u4ef6\u66f4\u65b0'} style={{ marginBottom: 16 }}>
      <Alert
        type={desktopUpdate.error ? 'error' : desktopUpdate.downloaded ? 'success' : desktopUpdate.available ? 'info' : 'success'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          desktopUpdate.error
            ? '\u66f4\u65b0\u68c0\u67e5\u5931\u8d25'
            : desktopUpdate.downloaded
              ? '\u66f4\u65b0\u5df2\u4e0b\u8f7d\u5b8c\u6210'
              : desktopUpdate.available
                ? `\u53d1\u73b0\u65b0\u7248\u672c ${desktopUpdate.latestVersion || ''}`
                : '\u53ef\u5728\u8f6f\u4ef6\u5185\u68c0\u67e5\u548c\u5b89\u88c5\u66f4\u65b0'
        }
        description={desktopUpdate.error || desktopUpdate.feedUrl || '\u901a\u8fc7\u963f\u91cc\u4e91 OSS \u66f4\u65b0\u901a\u9053\u68c0\u67e5\u3001\u4e0b\u8f7d\u5e76\u5b89\u88c5\u684c\u9762\u7aef\u65b0\u7248\u672c\u3002'}
      />
      <Space wrap>
        <Button icon={<CloudDownloadOutlined />} loading={desktopUpdate.checking} onClick={handleCheckDesktopUpdate}>
          {'\u68c0\u67e5\u66f4\u65b0'}
        </Button>
        <Button
          type="primary"
          disabled={!desktopUpdate.available || desktopUpdate.downloaded}
          loading={desktopUpdate.downloading}
          onClick={handleDownloadDesktopUpdate}
        >
          {'\u4e0b\u8f7d\u66f4\u65b0'}
        </Button>
        <Button disabled={!desktopUpdate.downloaded} onClick={handleInstallDesktopUpdate}>
          {'\u91cd\u542f\u5e76\u5b89\u88c5'}
        </Button>
      </Space>
      {desktopUpdate.downloading && (
        <Progress style={{ marginTop: 16 }} percent={desktopUpdate.progress} />
      )}
    </Card>
  );

  const handleResetData = () => {
    if (!dbService) {
      message.error('系统尚未加载完成');
      return;
    }
    try {
      const defaultData = {
        students: [],
        grades: [],
        courses: [],
        schedules: [],
        enrollments: [],
        payments: [],
        consumptions: [],
        institutions: [],
        schools: [],
        teachers: []
      };
      dbService.importAllData(defaultData);
      message.success('数据重置成功');
    } catch (error: any) {
      message.error(`重置失败：${error.message}`);
    }
  };

  const handleExport = () => {
    if (!dbService) {
      message.error('系统尚未加载完成');
      return;
    }
    try {
      const data = dbService.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('本地数据导出成功');
    } catch (error: any) {
      message.error(`导出失败：${error.message}`);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event: any) => {
        try {
          const data = JSON.parse(event.target.result);
          dbService.importAllData(data);
          message.success('本地数据导入成功');
        } catch (error: any) {
          message.error(`导入失败：${error.message}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const settingsPolicy = systemSettingsRolePolicy(runtimeConfig?.nodeRole);
  const authoritySurface = authoritySyncSurfacePolicy(runtimeConfig?.nodeRole);
  if (!settingsPolicy.isPrimaryHost) {
    let accountLabel = '\u7b49\u5f85\u7ba1\u7406\u5458\u6279\u51c6';
    try {
      const session = readDesktopAuthorizationSession();
      accountLabel = session.user?.name || session.authContext.userId;
    } catch (_error) {}
    return (
      <div>
        <Card title={'\u672c\u673a\u4e0e\u540c\u6b65'} style={{ marginBottom: 16 }}>
          <Alert type="info" showIcon message={'\u666e\u901a\u79bb\u7ebf\u5ba2\u6237\u7aef'} description={'\u540c\u6b65\u670d\u52a1\u4e0e\u8d26\u53f7\u7531\u7ba1\u7406\u5458\u7edf\u4e00\u914d\u7f6e\u3002\u672c\u673a\u65e0\u9700\u586b\u5199\u8def\u5f84\u3001\u4e91\u5730\u5740\u6216\u540c\u6b65\u5bc6\u94a5\u3002'} style={{ marginBottom: 16 }} />
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label={'\u8f6f\u4ef6\u7248\u672c'}>{APP_VERSION}</Descriptions.Item>
            <Descriptions.Item label={'\u540c\u6b65\u8d26\u53f7'}>{accountLabel}</Descriptions.Item>
            <Descriptions.Item label={'\u914d\u7f6e\u65b9\u5f0f'}><Tag color="blue">{'\u7ba1\u7406\u5458\u6258\u7ba1'}</Tag></Descriptions.Item>
          </Descriptions>
        </Card>
        {renderDesktopUpdatePanel()}
        <section id="sync-settings"><SyncSettings variant="quick" /></section>
      </div>
    );
  }

  return (
    <div>
      {renderDesktopUpdatePanel()}
      <Card title="数据主机与同步" style={{ marginBottom: 16 }}>
        <Alert
          type={runtimeConfig?.nodeRole === 'primary-host' ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={runtimeConfig?.nodeRole === 'primary-host' ? '当前配置为本地数据主机' : '当前配置为普通离线客户端'}
          description="本地数据主机保存权威数据和题库移动硬盘；普通离线客户端可断网修改，联网后经确认同步到主机。"
        />
        <Alert
          type={windowsHostFirewallStatus?.state === 'enabled' ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={'\u5c40\u57df\u7f51\u76f4\u8fde\uff08\u53ef\u9009\uff09'}
          description={(
            <Space direction="vertical" size={2}>
              <span>{'\u4e91\u4e2d\u7ee7\u59cb\u7ec8\u53ef\u7528\uff0c\u65e0\u9700\u8bbe\u7f6e Windows \u9632\u706b\u5899\u3002'}</span>
              <span>{'\u5c40\u57df\u7f51\u76f4\u8fde\u4ec5\u7528\u4e8e\u52a0\u5feb\u540c\u4e00\u4e13\u7528\u7f51\u7edc\u5185\u5df2\u6388\u6743\u8bbe\u5907\u8bbf\u95ee\u672c\u673a\u6570\u636e\u4e3b\u673a\u7684\u901f\u5ea6\u3002'}</span>
              <span>{windowsHostFirewallStatus?.state === 'enabled'
                ? `\u5df2\u542f\u7528\uff1a\u4ec5\u4e13\u7528\u7f51\u7edc\u3001\u672c\u5730\u5b50\u7f51\u3001TCP ${windowsHostFirewallStatus.localPort || '-'}`
                : '\u672a\u542f\u7528\u5c40\u57df\u7f51\u76f4\u8fde\u65f6\uff0c\u8f6f\u4ef6\u4f1a\u7ee7\u7eed\u901a\u8fc7\u4e91\u4e2d\u7ee7\u5de5\u4f5c\u3002'}</span>
              <span>{'\u4e0d\u9700\u8981\u624b\u5de5\u521b\u5efa\u9632\u706b\u5899\u89c4\u5219\u3002'}</span>
            </Space>
          )}
          action={(
            <Space>
              <Button size="small" loading={windowsHostFirewallLoading} onClick={() => void loadWindowsHostFirewallStatus()}>
                {'\u68c0\u67e5\u72b6\u6001'}
              </Button>
              {windowsHostFirewallStatus?.state !== 'enabled' && (
                <Popconfirm
                  title={'\u662f\u5426\u542f\u7528\u5c40\u57df\u7f51\u76f4\u8fde\uff1f'}
                  description={'\u5c06\u8bf7\u6c42\u4e00\u6b21 Windows \u7ba1\u7406\u5458\u6388\u6743\uff0c\u4ec5\u5141\u8bb8\u672c\u673a\u5df2\u5b89\u88c5\u7684\u6570\u636e\u4e3b\u673a\u7a0b\u5e8f\u5728\u4e13\u7528\u7f51\u7edc\u7684\u672c\u5730\u5b50\u7f51\u901a\u8fc7\u6307\u5b9a TCP \u7aef\u53e3\u63a5\u6536\u8fde\u63a5\u3002\u62d2\u7edd\u6388\u6743\u4e0d\u4f1a\u5f71\u54cd\u4e91\u4e2d\u7ee7\u3002'}
                  okText={'\u8bf7\u6c42\u6388\u6743'}
                  cancelText={'\u7ee7\u7eed\u4f7f\u7528\u4e91\u4e2d\u7ee7'}
                  onConfirm={() => void requestWindowsHostLanFirewall()}
                >
                  <Button size="small" type="primary" loading={windowsHostFirewallLoading}>
                    {'\u542f\u7528\u5c40\u57df\u7f51\u76f4\u8fde'}
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )}
        />
        <Alert
          type={questionBankStorageStatus?.available ? 'success' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={questionBankStorageStatus?.available ? '题库 SSD 在线' : '题库 SSD 未连接或不可用'}
          description={(
            <Space direction="vertical" size={2}>
              <span>当前路径：{questionBankStorageStatus?.root || runtimeConfig?.questionBankPath || '-'}</span>
              <span>storeId：{questionBankStorageStatus?.manifest?.storeId || runtimeConfig?.questionBankStoreId || '-'}</span>
              <span>写入状态：{questionBankStorageStatus?.writable ? '可写' : '保护/不可写'}</span>
              {questionBankStorageStatus?.pathChanged && <span>已通过 manifest 自动识别盘符变化。</span>}
              <span>{questionBankBindingPresentation(questionBankStorageStatus).label}</span>
              <span>DB authority: {questionBankBindingPresentation(questionBankStorageStatus).authority || '-'}</span>
              <span>{questionBankBindingPresentation(questionBankStorageStatus).warning}</span>
              {(questionBankStorageStatus?.reason || questionBankStorageStatus?.detail) && (
                <span>{questionBankStorageStatus.reason || questionBankStorageStatus.detail}</span>
              )}
            </Space>
          )}
          action={(
            <Space><Button size="small" loading={questionBankStorageLoading} onClick={loadQuestionBankStorageStatus}>
              检测题库盘
            </Button>{!questionBankStorageStatus?.binding && <Popconfirm title="Binding cannot switch implicitly. Continue?" onConfirm={bindCurrentQuestionBankStore}><Button size="small" type="primary">Bind store</Button></Popconfirm>}</Space>
          )}
        />
        <Alert
          type={backupTargetStatus?.nasBackup?.available ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message="备份目标状态"
          description={(
            <Space direction="vertical" size={2}>
              <span>
                本机缓存：{renderBackupTargetTag(backupTargetStatus?.localCache)}
                {backupTargetStatus?.localCache?.path || backupTargetStatus?.localCache?.reason || '-'}
              </span>
              <span>
                NAS 备份：{renderBackupTargetTag(backupTargetStatus?.nasBackup)}
                {backupTargetStatus?.nasBackup?.path || backupTargetStatus?.nasBackup?.reason || '未配置'}
              </span>
            </Space>
          )}
          action={(
            <Button size="small" onClick={loadBackupTargetStatus}>
              检测备份路径
            </Button>
          )}
        />
        <Form form={runtimeForm} layout="vertical">
          <Form.Item name="nodeRole" label="运行角色" rules={[{ required: true }]}>
            <Select
              disabled
              options={[
                { label: '本地数据主机', value: 'primary-host' },
                { label: '普通离线客户端', value: 'desktop-client' },
              ]}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message={'\u4e3b\u673a\u8eab\u4efd\u7531\u201c\u8eab\u4efd\u4e0e\u8bbe\u5907\u201d\u4e2d\u5fc3\u7ba1\u7406\uff0c\u4e0d\u80fd\u5728\u666e\u901a\u8bbe\u7f6e\u4e2d\u624b\u5de5\u5207\u6362\u3002'}
          />
          <Form.Item name="mainDbPath" label="主数据库路径" rules={[{ required: true }]}>
            <Input
              addonAfter={(
                <Button size="small" onClick={selectMainDbFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Form.Item name="questionBankPath" label="题库移动硬盘路径">
            <Input
              addonAfter={(
                <Button size="small" onClick={selectQuestionBankFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Form.Item name="questionAssetPath" label="题库附件路径">
            <Input />
          </Form.Item>
          <Form.Item name="hostBaseUrl" label="本地数据主机地址">
            <Input placeholder="http://192.168.1.10:3001" />
          </Form.Item>
          <Form.Item name="cloudBaseUrl" label="阿里云服务地址">
            <Input placeholder="https://your-domain.example.com" />
          </Form.Item>
          <Form.Item name="questionBankCandidatePaths" label="题库盘候选路径（支持热插拔/盘符变化）">
            <Select mode="tags" tokenSeparators={[';']} placeholder="例如 I:/GewuQuestionBank；换 Type-C 后可加入 J:/GewuQuestionBank" />
          </Form.Item>
          <Form.Item name="questionBankStoreId" label="题库盘 storeId">
            <Input disabled placeholder="初始化题库盘后自动读取 manifest.storeId" />
          </Form.Item>
          <Form.Item name="localCachePath" label="本机题库缓存/最近备份路径">
            <Input
              addonAfter={(
                <Button size="small" onClick={selectLocalCacheFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Form.Item name="nasBackupPath" label="NAS 备份/归档路径">
            <Input
              placeholder="例如 \\\\NAS\\GewuQuestionBankBackup"
              addonAfter={(
                <Button size="small" onClick={selectNasBackupFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Button type="primary" loading={runtimeLoading} onClick={handleSaveRuntimeConfig}>
            保存数据主机与同步配置
          </Button>
        </Form>
      </Card>

      <section id="sync-settings" style={{ marginBottom: 16 }}>
        <Collapse
          items={[{
            key: 'sync-advanced',
            label: String.fromCodePoint(25968, 25454, 21516, 27493, 65306, 39640, 32423, 25805, 20316, 19982, 31995, 32479, 35814, 24773),
            children: authoritySurface.showsHostExecutionMonitor ? <HostAuthorityExecutionMonitor /> : <SyncSettings variant="advanced" />,
          }]}
        />
      </section>

      <Card title="数据管理" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Button type="primary" icon={<ExportOutlined />} size="large" onClick={handleExport}>
            导出本地数据
          </Button>
          <Button icon={<ImportOutlined />} size="large" onClick={handleImport}>
            导入本地备份
          </Button>
          <Button icon={<CloudSyncOutlined />} size="large" loading={backupLoading} onClick={handleCreateServerBackup}>
            创建服务端快照
          </Button>
          <Button icon={<ReloadOutlined />} size="large" onClick={handleResetData}>
            重置所有数据
          </Button>
          <Popconfirm
            title="确定要清除所有数据吗？"
            description="此操作不可恢复。建议先创建服务端快照或导出本地备份。"
            onConfirm={() => {
              const emptyData = {
                students: [],
                grades: [],
                courses: [],
                schedules: [],
                enrollments: [],
                payments: [],
                consumptions: [],
                institutions: [],
                schools: [],
                teachers: []
              };
              dbService.importAllData(emptyData);
              message.success('数据已清除');
            }}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />} size="large">
              清除所有数据
            </Button>
          </Popconfirm>
        </Space>
        <Divider />
        <Text type="secondary">
          服务端快照写入后端 backup 目录，并在归档任务表记录状态；定时备份可调用 scripts/backup-archive.js，数据湖目录由 DATA_LAKE_DIR 配置。
        </Text>
      </Card>

      <Card title="服务端备份与恢复" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={backupJobs}
          pagination={{ pageSize: 5 }}
          columns={[
            {
              title: '状态',
              dataIndex: 'status',
              render: (status: string) => <Tag color={status === 'finished' || status === 'restored' ? 'green' : status === 'failed' ? 'red' : 'blue'}>{status}</Tag>,
            },
            {
              title: '数据量',
              dataIndex: 'affectedRows',
            },
            {
              title: '保留天数',
              dataIndex: 'retentionDays',
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (value: string) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
            },
            {
              title: '操作',
              render: (_, record: BackupJob) => (
                <Space>
                  <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => handleDownloadBackup(record.id)}>
                    下载
                  </Button>
                  <Popconfirm
                    title="确认从该快照恢复？"
                    description="恢复会覆盖同 ID 数据，执行前请确认已保存当前状态。"
                    onConfirm={() => handleRestoreBackup(record.id)}
                    okText="恢复"
                    cancelText="取消"
                  >
                    <Button size="small" icon={<RollbackOutlined />}>
                      恢复
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title="软件更新" style={{ marginBottom: 16 }}>
        <Alert
          type={desktopUpdate.error ? 'error' : desktopUpdate.downloaded ? 'success' : desktopUpdate.available ? 'info' : 'success'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            desktopUpdate.error
              ? '更新检查失败'
              : desktopUpdate.downloaded
                ? '更新已下载完成'
                : desktopUpdate.available
                  ? `发现新版本 ${desktopUpdate.latestVersion || ''}`
                  : '可在软件内检查和安装更新'
          }
          description={desktopUpdate.error || desktopUpdate.feedUrl || '以后优先使用内置更新；夸克安装包仅作为备用下载。'}
        />
        <Space wrap>
          <Button
            icon={<CloudDownloadOutlined />}
            loading={desktopUpdate.checking}
            onClick={handleCheckDesktopUpdate}
          >
            检查更新
          </Button>
          <Button
            type="primary"
            disabled={!desktopUpdate.available || desktopUpdate.downloaded}
            loading={desktopUpdate.downloading}
            onClick={handleDownloadDesktopUpdate}
          >
            下载更新
          </Button>
          <Button
            disabled={!desktopUpdate.downloaded}
            onClick={handleInstallDesktopUpdate}
          >
            重启并安装
          </Button>
        </Space>
        {desktopUpdate.downloading && (
          <Progress style={{ marginTop: 16 }} percent={desktopUpdate.progress} />
        )}
      </Card>

      <Card title="系统信息">
        <div style={{ color: '#666', lineHeight: '1.8' }}>
          <p>版本：{APP_VERSION}</p>
          <p>桌面数据：浏览器本地存储 IndexedDB/LocalStorage</p>
          <p>服务端备份：JSON 快照 + 归档任务状态 + 可选数据湖副本</p>
          <p>更新日期：{dayjs().format('YYYY-MM-DD')}</p>
          <p>软件作者：小龙虾</p>
        </div>
      </Card>
    </div>
  );
};

export default SystemSettings;
