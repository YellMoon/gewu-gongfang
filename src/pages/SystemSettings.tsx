import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, message, Progress, Space, Tag } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { APP_VERSION } from '../generated/version';
import SyncSettings from './SyncSettings';
import type { CloudSyncContext } from '../navigation/navigationContext';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import {
  desktopUpdateErrorMessage,
  desktopUpdateStateAfterCheck,
  invokeDesktopUpdateCheck,
} from '../services/desktopUpdateClient.mjs';

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

const SystemSettings: React.FC<{ context?: CloudSyncContext }> = ({ context }) => {
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState>({
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: 0,
  });

  useEffect(() => {
    if (context?.section !== 'sync-settings') return;
    window.setTimeout(() => document.getElementById('sync-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [context]);

  useEffect(() => {
    const api = window.api;
    if (!api?.on) return undefined;
    const offAvailable = api.on('update-available', (info: any) => {
      setDesktopUpdate(prev => ({ ...prev, checking: false, available: true, latestVersion: info?.version || prev.latestVersion, error: undefined }));
    });
    const offNotAvailable = api.on('update-not-available', () => {
      setDesktopUpdate(prev => ({ ...prev, checking: false, available: false, downloading: false, downloaded: false, progress: 0, error: undefined }));
      message.success('\u5f53\u524d\u5df2\u7ecf\u662f\u6700\u65b0\u7248\u672c');
    });
    const offProgress = api.on('download-progress', (progress: any) => {
      setDesktopUpdate(prev => ({ ...prev, downloading: true, progress: Math.round(Number(progress?.percent || 0)) }));
    });
    const offDownloaded = api.on('update-downloaded', () => {
      setDesktopUpdate(prev => ({ ...prev, downloading: false, downloaded: true, progress: 100 }));
      message.success('\u66f4\u65b0\u5df2\u4e0b\u8f7d\u5b8c\u6210\uff0c\u53ef\u91cd\u542f\u5b89\u88c5');
    });
    const offError = api.on('update-error', (error: any) => {
      setDesktopUpdate(prev => ({ ...prev, checking: false, downloading: false, error: String(error || '\u66f4\u65b0\u5931\u8d25') }));
    });
    return () => {
      offAvailable();
      offNotAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
  }, []);

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

  let accountLabel = '\u7b49\u5f85\u767b\u5f55';
  try {
    const session = readDesktopAuthorizationSession();
    accountLabel = session.user?.name || session.authContext.userId;
  } catch (_error) {}

  return (
    <div>
      <Card title={'\u8d26\u53f7\u4e0e\u4e91\u7aef\u540c\u6b65'} style={{ marginBottom: 16 }}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={'\u7edf\u4e00\u684c\u9762\u7aef'} description={'\u4e1a\u52a1\u6570\u636e\u548c\u9898\u5e93\u6587\u5b57\u5185\u5bb9\u7531\u4e91\u7aef\u88c1\u51b3\u3002\u672c\u673a\u79bb\u7ebf\u4fee\u6539\u53ea\u4f5c\u4e3a\u8349\u7a3f\uff0c\u8054\u7f51\u540e\u5fc5\u987b\u7531\u7528\u6237\u786e\u8ba4\u63d0\u4ea4\u3002'} />
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={'\u8f6f\u4ef6\u7248\u672c'}>{APP_VERSION}</Descriptions.Item>
          <Descriptions.Item label={'\u5f53\u524d\u8d26\u53f7'}>{accountLabel}</Descriptions.Item>
          <Descriptions.Item label={'\u9898\u5e93\u5bcc\u5a92\u4f53'}><Tag color="blue">NAS \u53d7\u63a7\u5b58\u50a8</Tag></Descriptions.Item>
          <Descriptions.Item label={'\u8bbe\u5907\u767b\u8bb0'}><Tag color="green">\u9996\u6b21\u767b\u5f55\u540e\u9759\u9ed8\u5b8c\u6210</Tag></Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title={'\u8f6f\u4ef6\u66f4\u65b0'} style={{ marginBottom: 16 }}>
        <Alert type={desktopUpdate.error ? 'error' : desktopUpdate.downloaded ? 'success' : desktopUpdate.available ? 'info' : 'success'} showIcon style={{ marginBottom: 16 }} message={desktopUpdate.error ? '\u66f4\u65b0\u68c0\u67e5\u5931\u8d25' : desktopUpdate.downloaded ? '\u66f4\u65b0\u5df2\u4e0b\u8f7d\u5b8c\u6210' : desktopUpdate.available ? `\u53d1\u73b0\u65b0\u7248\u672c ${desktopUpdate.latestVersion || ''}` : '\u53ef\u5728\u8f6f\u4ef6\u5185\u68c0\u67e5\u548c\u5b89\u88c5\u66f4\u65b0'} description={desktopUpdate.error || desktopUpdate.feedUrl || '\u901a\u8fc7\u963f\u91cc\u4e91 OSS \u66f4\u65b0\u901a\u9053\u68c0\u67e5\u3001\u4e0b\u8f7d\u5e76\u5b89\u88c5\u7edf\u4e00\u684c\u9762\u7aef\u65b0\u7248\u672c\u3002'} />
        <Space wrap>
          <Button icon={<CloudDownloadOutlined />} loading={desktopUpdate.checking} onClick={handleCheckDesktopUpdate}>{'\u68c0\u67e5\u66f4\u65b0'}</Button>
          <Button type="primary" disabled={!desktopUpdate.available || desktopUpdate.downloaded} loading={desktopUpdate.downloading} onClick={handleDownloadDesktopUpdate}>{'\u4e0b\u8f7d\u66f4\u65b0'}</Button>
          <Button disabled={!desktopUpdate.downloaded} onClick={handleInstallDesktopUpdate}>{'\u91cd\u542f\u5e76\u5b89\u88c5'}</Button>
        </Space>
        {desktopUpdate.downloading && <Progress style={{ marginTop: 16 }} percent={desktopUpdate.progress} />}
      </Card>
      <section id="sync-settings"><SyncSettings variant="advanced" /></section>
    </div>
  );
};

export default SystemSettings;
