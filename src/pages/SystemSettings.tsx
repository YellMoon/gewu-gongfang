import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, message, Progress, Space } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import desktopPackage from '../../package.json';
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
  errorPhase?: 'check' | 'download' | 'install';
};

const SystemSettings: React.FC = () => {
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState>({
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: 0,
  });

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
      setDesktopUpdate(prev => ({ ...prev, downloading: false, downloaded: true, progress: 100, error: undefined }));
      message.success('\u66f4\u65b0\u5df2\u4e0b\u8f7d\u5b8c\u6210\uff0c\u53ef\u91cd\u542f\u5b89\u88c5');
    });
    const offError = api.on('update-error', (error: any) => {
      setDesktopUpdate(prev => {
        const phase = prev.errorPhase || 'check';
        return { ...prev, checking: false, downloading: false, error: desktopUpdateErrorMessage(error, phase), errorPhase: phase };
      });
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
      const safeError = desktopUpdateErrorMessage({ code: 'DESKTOP_UPDATE_BRIDGE_UNAVAILABLE' }, 'check');
      setDesktopUpdate(prev => ({ ...prev, checking: false, error: safeError, errorPhase: 'check' }));
      message.error(safeError);
      return;
    }
    setDesktopUpdate(prev => ({ ...prev, checking: true, error: undefined, errorPhase: 'check' }));
    try {
      const result = await invokeDesktopUpdateCheck(window.api);
      if (!result?.success) {
        const safeError = desktopUpdateErrorMessage(result?.code ? result : result?.error || result, 'check');
        setDesktopUpdate(prev => ({ ...prev, checking: false, error: safeError, errorPhase: 'check' }));
        message.error(safeError);
        return;
      }
      setDesktopUpdate(prev => desktopUpdateStateAfterCheck(prev, result));
    } catch (error: any) {
      const safeError = desktopUpdateErrorMessage(error, 'check');
      setDesktopUpdate(prev => ({ ...prev, checking: false, error: safeError, errorPhase: 'check' }));
      message.error(safeError);
    }
  };

  const handleDownloadDesktopUpdate = async () => {
    setDesktopUpdate(prev => ({ ...prev, downloading: true, error: undefined, errorPhase: 'download' }));
    try {
      const result = await window.api?.invoke('download-update');
      if (!result?.success) {
        const safeError = desktopUpdateErrorMessage(result?.code ? result : result?.error || result, 'download');
        setDesktopUpdate(prev => ({ ...prev, downloading: false, error: safeError, errorPhase: 'download' }));
        message.error(safeError);
      }
    } catch (error: any) {
      const safeError = desktopUpdateErrorMessage(error, 'download');
      setDesktopUpdate(prev => ({ ...prev, downloading: false, error: safeError, errorPhase: 'download' }));
      message.error(safeError);
    }
  };

  const handleInstallDesktopUpdate = async () => {
    setDesktopUpdate(prev => ({ ...prev, error: undefined, errorPhase: 'install' }));
    try {
      const result = await window.api?.invoke('install-update');
      if (!result?.success) {
        const safeError = desktopUpdateErrorMessage(result?.code ? result : result?.error || result, 'install');
        setDesktopUpdate(prev => ({ ...prev, error: safeError, errorPhase: 'install' }));
        message.error(safeError);
      }
    } catch (error: any) {
      const safeError = desktopUpdateErrorMessage(error, 'install');
      setDesktopUpdate(prev => ({ ...prev, error: safeError, errorPhase: 'install' }));
      message.error(safeError);
    }
  };

  return (
    <Card title="软件与更新" extra={<span>当前版本 {desktopPackage.version}</span>}>
      {(desktopUpdate.error || desktopUpdate.available || desktopUpdate.downloaded) && <Alert
        type={desktopUpdate.error ? 'error' : desktopUpdate.downloaded ? 'success' : 'info'} showIcon style={{ marginBottom: 16 }}
        message={desktopUpdate.error ? desktopUpdate.errorPhase === 'install' ? '更新安装失败' : desktopUpdate.errorPhase === 'download' ? '更新下载失败' : '更新检查失败' : desktopUpdate.downloaded ? '更新已下载完成' : `发现新版本 ${desktopUpdate.latestVersion || ''}`}
        description={desktopUpdate.error || undefined} />}
      <Space wrap>
        <Button icon={<CloudDownloadOutlined />} loading={desktopUpdate.checking} onClick={handleCheckDesktopUpdate}>检查更新</Button>
        {desktopUpdate.available && !desktopUpdate.downloaded && <Button type="primary" loading={desktopUpdate.downloading} onClick={handleDownloadDesktopUpdate}>下载更新</Button>}
        {desktopUpdate.downloaded && <Button type="primary" onClick={handleInstallDesktopUpdate}>重启并安装</Button>}
      </Space>
      {desktopUpdate.downloading && <Progress style={{ marginTop: 16 }} percent={desktopUpdate.progress} />}
    </Card>
  );
};

export default SystemSettings;
