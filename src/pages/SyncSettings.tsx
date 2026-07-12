/**
 * 同步设置页面 v2 — CRDT 引擎同步状态 + 控制面板
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Tag, Descriptions, Divider, message, Modal, Statistic, Row, Col, Alert, Table, Space, Collapse } from 'antd';
import { SyncOutlined, CloudSyncOutlined, CloudServerOutlined, WarningOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { SyncEngine, SyncStatus } from '../services/syncEngine';
import { getSyncUrl, pushSyncBatch, pullSyncOps, registerSyncDevice, requestSyncAuthorization } from '../services/syncApi';
import { getRuntimeConfig, RuntimeConfig } from '../services/runtimeConfigClient';
import browserDatabase from '../services/browserDatabase';
import type { CloudSyncContext } from '../navigation/navigationContext';
import { runOneClickSync } from '../services/oneClickSyncService.mjs';
import { createCloudRelaySyncTransport, createDirectSyncTransport, discoverLanDirectSyncTransports } from '../services/oneClickSyncTransports.mjs';
import { hydrateDesktopAuthorizationSession, readDesktopAuthorizationSession, startPairing, pollOrExchange } from '../services/desktopAuthorizationSession.mjs';
import { getSyncPresentation } from '../services/syncPresentation.mjs';
import { resolveManagedSyncConfig, syncFailureMessage } from '../services/managedSyncConfig.mjs';

interface SyncSettingsProps {
  context?: CloudSyncContext;
  variant?: 'quick' | 'advanced';
  onNavigateToSettings?: (mode?: 'issues' | 'pending') => void;
}

const SyncSettings: React.FC<SyncSettingsProps> = ({ context, variant = 'advanced', onNavigateToSettings }) => {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<any[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [oneClickLoading, setOneClickLoading] = useState(false);
  const [pairing, setPairing] = useState<any>(null);
  const [pairedUser, setPairedUser] = useState<any>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);
  const handleStartPairing = async () => {
    setPairingLoading(true);
    try {
      const config: any = resolveManagedSyncConfig(runtimeConfig || {});
      const baseUrl = config.nodeRole === 'primary-host' ? config.hostBaseUrl : config.cloudBaseUrl;
      const result = await startPairing({
        baseUrl,
        deviceId: engineRef.current?.getDeviceId(),
        deviceName: runtimeConfig?.deviceId || 'desktop',
      });
      setPairing(result);
      message.info(`\u914d\u5bf9\u7801: ${result.pairingCode}`);
    } catch (error: any) {
      message.error(error.code || error.message);
    } finally {
      setPairingLoading(false);
    }
  };
  const handleRefreshPairing = async () => {
    setPairingLoading(true);
    try {
      const result = await pollOrExchange();
      setPairing(null);
      setPairedUser(result.user || { id: result.userId });
      message.success('\u5f53\u524d\u8bbe\u5907\u5df2\u7531\u7ba1\u7406\u5458\u7ed1\u5b9a');
    } catch (error: any) {
      message.warning(error.code || error.message);
    } finally {
      setPairingLoading(false);
    }
  };

  // 延迟初始化 SyncEngine，捕获构造函数可能的异常
  useEffect(() => {
    if (engineRef.current) return;
    try {
      const syncEngine = new SyncEngine();
      engineRef.current = syncEngine;
      setEngine(syncEngine);
      setStatus(syncEngine.getStatus());
      setInitError(null);
    } catch (err: any) {
      console.error('SyncEngine 初始化失败:', err);
      setInitError(err?.message || '同步引擎初始化失败，请检查本地存储是否可用');
    }
  }, []);

  useEffect(() => {
    getRuntimeConfig()
      .then(config => setRuntimeConfig({ ...config, cloudBaseUrl: resolveManagedSyncConfig(config).cloudBaseUrl }))
      .catch(() => setRuntimeConfig(null));
    hydrateDesktopAuthorizationSession()
      .then(session => setPairedUser(session.user))
      .catch(() => setPairedUser(null));
  }, []);

  const loadSyncConflicts = useCallback(async () => {
    setConflictsLoading(true);
    try {
      const res = await fetch(await getSyncUrl('/conflicts'));
      const data = await res.json();
      if (data.success) setSyncConflicts(data.conflicts || []);
    } catch (_err) {
      setSyncConflicts([]);
    } finally {
      setConflictsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSyncConflicts();
  }, [loadSyncConflicts]);

  const resolveConflict = async (id: string, strategy: 'host-wins' | 'client-wins' | 'reject') => {
    const label = strategy === 'host-wins' ? '主机优先' : strategy === 'client-wins' ? '客户端优先' : '拒绝';
    try {
      const res = await fetch(await getSyncUrl(`/conflicts/${id}/resolve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, label }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '处理冲突失败');
      message.success(`已处理：${label}`);
      loadSyncConflicts();
    } catch (error: any) {
      message.error(error.message || '处理冲突失败');
    }
  };

  // 刷新同步状态
  const refreshStatus = useCallback(() => {
    if (engineRef.current) {
      setStatus(engineRef.current.getStatus());
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    // 每 5 秒刷新状态
    const timer = setInterval(refreshStatus, 5000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  // 手动推送
  const handleAuthorizedPush = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    const pending = eng.getPendingChanges();
    if (pending.length === 0) {
      message.info('没有待同步的离线更改');
      return;
    }

    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `检测到 ${pending.length} 条离线更改`,
        content: '是否申请同步权限并同步到本地数据主机？同步前不会静默覆盖主机数据。',
        okText: '申请同步权限并推送',
        cancelText: '稍后',
        onCancel: () => resolve(false),
        onOk: async () => {
          try {
            message.loading({ content: '正在申请同步权限...', key: 'sync' });
            await registerSyncDevice({
              deviceId: eng.getDeviceId(),
              role: runtimeConfig?.nodeRole || 'desktop-client',
              deviceName: runtimeConfig?.deviceId || eng.getDeviceId(),
            });
            const auth = await requestSyncAuthorization({
              deviceId: eng.getDeviceId(),
              role: runtimeConfig?.nodeRole || 'desktop-client',
            });
            if (!auth.success) throw new Error(auth.error || '申请同步权限失败');
            message.loading({ content: '正在推送离线更改...', key: 'sync' });
            const result = await eng.push(batch => pushSyncBatch(batch, {
              authorizationToken: auth.authorization.token,
            }));
            refreshStatus();
            if (!result.success) {
              message.error({ content: `推送失败，${pending.length} 条离线更改已保留`, key: 'sync' });
              resolve(false);
              return;
            }
            message.success({ content: `同步完成，已推送 ${result.pushed} 条离线更改`, key: 'sync' });
            (window as any).operateLogger?.log('同步', `申请同步权限并推送 ${result.pushed} 条离线更改`, '云同步');
            resolve(true);
          } catch (error: any) {
            refreshStatus();
            message.error({ content: error.message || '申请同步权限失败', key: 'sync' });
            resolve(false);
          }
        },
      });
    });
  };

  // 手动拉取
  const handlePull = async () => {
    const eng = engineRef.current;
    if (!eng) return false;

    message.loading({ content: '正在拉取云端变更...', key: 'pull' });

    const localData = browserDatabase.buildSyncLocalDataMaps();
    const result = await eng.pull(pullSyncOps, localData);
    if (result.success) {
      browserDatabase.applySyncLocalDataMaps(localData);
      refreshStatus();
      const conflictText = result.conflicts.length > 0 ? `，${result.conflicts.length} 条冲突保留本地` : '';
      message.success({ content: `已拉取并应用 ${result.applied} 条云端变更${conflictText}`, key: 'pull' });
      (window as any).operateLogger?.log('同步', `手动拉取 ${result.applied} 条云端变更`, '云同步');
      return true;
    }

    refreshStatus();
    message.error({ content: '拉取失败，本地数据和待同步队列未变更', key: 'pull' });
    return false;
  };

  const handleSyncBoth = async () => {
    const pushed = await handleAuthorizedPush();
    if (pushed === false) return;
    await handlePull();
  };

  const oneClickText = {
    oneClick: '\u4e0e\u6570\u636e\u4e3b\u673a\u53cc\u5411\u540c\u6b65',
    confirmTitle: '\u786e\u8ba4\u53cc\u5411\u540c\u6b65',
    direct: '\u5c40\u57df\u7f51\u76f4\u8fde',
    cloud: '\u963f\u91cc\u4e91\u4e2d\u7ee7',
    confirmIntro: '\u540c\u6b65\u3002\u8bf7\u786e\u8ba4\u4ee5\u4e0b\u53d8\u52a8\uff1a',
    upload: '\u672c\u673a\u5c06\u4e0a\u4f20\uff1a',
    download: '\u5c06\u4ece\u4e3b\u673a\u83b7\u53d6\uff1a',
    risk: '\u9ad8\u98ce\u9669/\u5220\u9664\u9879\uff1a',
    item: '\u6761',
    create: '\u65b0\u589e',
    update: '\u4fee\u6539',
    delete: '\u5220\u9664',
    noChange: '\u65e0\u53d8\u66f4',
    relayHint: '\u4e91\u4e2d\u7ee7\u6a21\u5f0f\u4f1a\u5148\u63d0\u4ea4\u540c\u6b65\u8bf7\u6c42\uff1b\u5982\u679c\u4e3b\u673a\u7535\u8111\u6682\u672a\u5904\u7406\uff0c\u5f53\u524d\u672c\u673a\u961f\u5217\u4f1a\u7ee7\u7eed\u4fdd\u7559\u3002',
    ok: '\u786e\u8ba4\u53cc\u5411\u540c\u6b65',
    cancel: '\u53d6\u6d88',
    synced: '\u540c\u6b65\u5b8c\u6210',
    waiting: '\u540c\u6b65\u8bf7\u6c42\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u4e3b\u673a\u7535\u8111\u4e0a\u7ebf\u5904\u7406',
    cancelled: '\u5df2\u53d6\u6d88\u540c\u6b65\uff0c\u672c\u673a\u5f85\u540c\u6b65\u961f\u5217\u672a\u53d8\u66f4',
    failed: '\u4e00\u952e\u540c\u6b65\u5931\u8d25\uff0c\u5f85\u540c\u6b65\u961f\u5217\u5df2\u4fdd\u7559',
    logCategory: '\u4e91\u540c\u6b65',
    logAction: '\u540c\u6b65',
  };

  const isLocalHostBase = (value?: string) => {
    const text = String(value || '').toLowerCase();
    return text.includes('127.0.0.1') || text.includes('localhost');
  };

  const formatActionSummary = (summary: any) => {
    const parts = [
      summary?.byAction?.create ? `${oneClickText.create} ${summary.byAction.create} ${oneClickText.item}` : '',
      summary?.byAction?.update ? `${oneClickText.update} ${summary.byAction.update} ${oneClickText.item}` : '',
      summary?.byAction?.delete ? `${oneClickText.delete} ${summary.byAction.delete} ${oneClickText.item}` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('\uff0c') : oneClickText.noChange;
  };

  const confirmOneClickPreview = (preview: any) => new Promise<boolean>((resolve) => {
    if (!preview.confirmationRequired) {
      resolve(true);
      return;
    }
    Modal.confirm({
      title: oneClickText.confirmTitle,
      width: 620,
      content: (
        <div style={{ lineHeight: 1.8 }}>
          <p>{`${preview.channel === 'direct' ? oneClickText.direct : oneClickText.cloud}${oneClickText.confirmIntro}`}</p>
          <p><strong>{oneClickText.upload}</strong>{`${preview.upload.total} ${oneClickText.item}\uff08${formatActionSummary(preview.upload)}\uff09`}</p>
          <p><strong>{oneClickText.download}</strong>{`${preview.download.total} ${oneClickText.item}\uff08${formatActionSummary(preview.download)}\uff09`}</p>
          <p><strong>{oneClickText.risk}</strong>{`${preview.risk.high} ${oneClickText.item}`}</p>
          {preview.channel === 'cloud' && <p>{oneClickText.relayHint}</p>}
        </div>
      ),
      okText: oneClickText.ok,
      cancelText: oneClickText.cancel,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

  const handleOneClickSync = async () => {
    const eng = engineRef.current;
    if (!eng || oneClickLoading) return;
    setOneClickLoading(true);
    try {
      const config: any = resolveManagedSyncConfig(runtimeConfig || await getRuntimeConfig());
      const transports = [];
      if (config?.cloudBaseUrl) {
        try {
          const discovered = await discoverLanDirectSyncTransports({
            baseUrl: config.cloudBaseUrl,
            deviceId: eng.getDeviceId(),
            role: config.nodeRole || 'desktop-client',
            deviceName: config.deviceId || eng.getDeviceId(),
            desktopSyncToken: config.desktopSyncToken || '',
            sessionResolver: () => readDesktopAuthorizationSession(),
          });
          transports.push(...discovered);
        } catch (_error) {
          // Cloud relay remains available even when LAN discovery is unavailable.
        }
      }
      if (config?.hostBaseUrl && (config.nodeRole === 'primary-host' || !isLocalHostBase(config.hostBaseUrl))) {
        const manualDirect = createDirectSyncTransport({
          baseUrl: config.hostBaseUrl,
          deviceId: eng.getDeviceId(),
          role: config.nodeRole || 'desktop-client',
          deviceName: config.deviceId || eng.getDeviceId(),
          sessionResolver: () => readDesktopAuthorizationSession(),
        });
        if (!transports.some((transport: any) => transport.baseUrl === manualDirect.baseUrl)) transports.push(manualDirect);
      }
      if (config?.cloudBaseUrl) {
        transports.push(createCloudRelaySyncTransport({
          baseUrl: config.cloudBaseUrl,
          deviceId: eng.getDeviceId(),
          desktopSyncToken: config.desktopSyncToken || '',
          sessionResolver: () => readDesktopAuthorizationSession(),
        }));
      }
      const result = await runOneClickSync({
        engine: eng,
        transports,
        confirmPreview: confirmOneClickPreview,
        buildLocalDataMaps: () => browserDatabase.buildSyncLocalDataMaps(),
        applyLocalDataMaps: (localData: any) => browserDatabase.applySyncLocalDataMaps(localData),
      });
      refreshStatus();
      if (result.status === 'synced') {
        message.success(`${oneClickText.synced}\uff1a\u4e0a\u4f20 ${result.uploaded} \u6761\uff0c\u62c9\u53d6 ${result.downloaded} \u6761\uff0c\u51b2\u7a81 ${result.conflicts} \u6761`);
        (window as any).operateLogger?.log(oneClickText.logAction, `${oneClickText.oneClick}: ${result.channel}`, oneClickText.logCategory);
        return;
      }
      if (result.status === 'waiting-host') {
        message.info(`${oneClickText.waiting}${result.requestId ? `\uff08${result.requestId}\uff09` : ''}`);
        (window as any).operateLogger?.log(oneClickText.logAction, `${oneClickText.waiting}: ${result.requestId || ''}`, oneClickText.logCategory);
        return;
      }
      if (result.status === 'cancelled') {
        message.info(oneClickText.cancelled);
        return;
      }
      message.error(syncFailureMessage(result.error));
    } catch (error: any) {
      refreshStatus();
      message.error(syncFailureMessage(error.code || error.message));
    } finally {
      setOneClickLoading(false);
    }
  };

  // 重置同步引擎
  const handleReset = () => {
    const eng = engineRef.current;
    if (!eng) return;
    Modal.confirm({
      title: '重置同步引擎',
      content: '此操作将清除所有待同步队列和向量时钟，确定继续？',
      okText: '确定重置',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        eng.reset();
        refreshStatus();
        message.success('同步引擎已重置');
        (window as any).operateLogger?.log('设置', '重置同步引擎', '云同步');
      },
    });
  };

  const formatTime = (ts: number | null): string => {
    if (!ts) return '从未同步';
    const date = new Date(ts);
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  // 重新初始化同步引擎
  const handleReinitialize = () => {
    setInitError(null);
    setEngine(null);
    setStatus(null);
    engineRef.current = null;
    // 延迟重新尝试初始化
    setTimeout(() => {
      try {
        const syncEngine = new SyncEngine();
        engineRef.current = syncEngine;
        setEngine(syncEngine);
        setStatus(syncEngine.getStatus());
        setInitError(null);
      } catch (err: any) {
        console.error('SyncEngine 重新初始化失败:', err);
        setInitError(err?.message || '同步引擎初始化失败，请检查本地存储是否可用');
      }
    }, 100);
  };

  // 初始化错误页面
  if (initError) {
    return (
      <div style={{ padding: 16 }}>
        <Alert
          message="同步引擎初始化失败"
          description={initError}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={handleReinitialize}
          style={{ marginBottom: 16 }}
        >
          重新初始化
        </Button>
        <Card
          title={<span><WarningOutlined style={{ marginRight: 8 }} />同步协议说明</span>}
          size="small"
        >
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
            <li><strong>CRDT 模式</strong>：所有操作以 Operation 为单元，独立存储向量时钟</li>
            <li><strong>离线优先</strong>：变更先写入本地，在线后异步推送到服务端</li>
            <li><strong>冲突解决</strong>：Last-Writer-Wins（LWW）+ 字段级别合并，避免整条覆盖</li>
            <li><strong>增量同步</strong>：仅传输有变更的字段，减少带宽消耗</li>
            <li><strong>分布式兼容</strong>：向量时钟支持多客户端同时修改（桌面端 + 小程序 + 管理员）</li>
          </ul>
        </Card>
      </div>
    );
  }

  // 引擎未初始化（加载中）
  if (!engine || !status) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 16 }}>
        同步引擎初始化中...
      </div>
    );
  }

  const eng = engineRef.current!;
  const presentation = getSyncPresentation(runtimeConfig?.nodeRole || 'desktop-client', {
    ...status,
    conflictCount: syncConflicts.length,
  });

  if (variant === 'quick') {
    return (
      <div className="sync-quick-panel">
        <div className="sync-quick-panel__heading">
          <div>
            <div className="sync-quick-panel__eyebrow">{presentation.isHost ? '\u6570\u636e\u4e3b\u673a' : '\u5f53\u524d\u7535\u8111'}</div>
            <strong>{presentation.statusText}</strong>
          </div>
          <Tag color={status.online ? 'success' : 'warning'}>{status.online ? '\u5728\u7ebf' : '\u79bb\u7ebf'}</Tag>
        </div>
        {presentation.isHost ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Button type="primary" block onClick={() => onNavigateToSettings?.('pending')}>
              {'\u5904\u7406\u5f85\u540c\u6b65\u8bf7\u6c42'}
            </Button>
            <Button block onClick={() => onNavigateToSettings?.('issues')}>
              {'\u67e5\u770b\u51b2\u7a81\u5ba1\u6838'}{syncConflicts.length > 0 ? ` (${syncConflicts.length})` : ''}
            </Button>
          </Space>
        ) : (
          <>
            {pairedUser ? (
              <Alert type="success" showIcon message={`\u5df2\u7ed1\u5b9a\uff1a${pairedUser.name || pairedUser.id}`} description={'\u8d26\u53f7\u4e0e\u89d2\u8272\u7531\u7ba1\u7406\u5458\u7edf\u4e00\u7ba1\u7406'} style={{ marginBottom: 10 }} />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 10 }}>
                <Alert type="warning" showIcon message={'\u5f53\u524d\u8bbe\u5907\u5c1a\u672a\u7ed1\u5b9a\u540c\u6b65\u8d26\u53f7'} description={'\u4e0d\u9700\u586b\u5199\u624b\u673a\u53f7\uff1b\u7531\u8d85\u7ea7\u7ba1\u7406\u5458\u786e\u8ba4\u8bbe\u5907\u5e76\u9009\u62e9\u771f\u5b9e\u8d26\u53f7\u3002'} />
                {!pairing ? <Button block loading={pairingLoading} onClick={handleStartPairing}>{'\u7533\u8bf7\u7ed1\u5b9a\u5f53\u524d\u8bbe\u5907'}</Button> : <Space wrap><span>{'\u914d\u5bf9\u7801\uff1a'}</span><Tag color="blue">{pairing.pairingCode}</Tag><Button loading={pairingLoading} onClick={handleRefreshPairing}>{'\u5237\u65b0\u6279\u51c6\u72b6\u6001'}</Button></Space>}
              </Space>
            )}
            <Button type="primary" size="large" block icon={<SyncOutlined />} loading={oneClickLoading} onClick={handleOneClickSync}>
              {'\u4e0e\u6570\u636e\u4e3b\u673a\u53cc\u5411\u540c\u6b65'}
            </Button>
            <div className="sync-quick-panel__helper">
              {'\u540c\u6b65\u524d\u5148\u9884\u89c8\u5e76\u786e\u8ba4\uff1b\u968f\u540e\u4e0a\u4f20\u672c\u673a\u66f4\u6539\uff0c\u518d\u83b7\u53d6\u5e76\u5408\u5e76\u4e3b\u673a\u6700\u65b0\u6570\u636e\u3002'}
            </div>
          </>
        )}
        <div className="sync-quick-panel__footer">
          {'\u4e0a\u6b21\u540c\u6b65\uff1a'}{formatTime(status.lastSyncTime)}
          <Button type="link" size="small" onClick={() => onNavigateToSettings?.()}>
            {'\u540c\u6b65\u8bbe\u7f6e'}
          </Button>
        </div>
      </div>
    );
  }

  const contextAlert = context?.mode ? (
    <Alert
      type={status.pendingCount > 0 || context.mode === 'issues' ? 'warning' : 'info'}
      showIcon
      message={context.mode === 'issues' ? '同步异常入口' : '待同步入口'}
      description={status.pendingCount > 0 ? `当前有 ${status.pendingCount} 条待同步变更` : '当前同步正常，没有待处理项'}
      style={{ marginBottom: 16 }}
    />
  ) : null;

  return (
    <div style={{ padding: 16 }}>
      {contextAlert}
      <Card title={'\u5f53\u524d\u8bbe\u5907\u540c\u6b65\u8eab\u4efd'} style={{marginBottom:16}}>
        {pairedUser ? <Alert type="success" showIcon message={`\u5df2\u7531\u7ba1\u7406\u5458\u7ed1\u5b9a\uff1a${pairedUser.name || pairedUser.id}`} description={'\u8d26\u53f7\u548c\u89d2\u8272\u7531\u670d\u52a1\u7aef\u7ba1\u7406\uff0c\u5f53\u524d\u7535\u8111\u65e0\u6cd5\u81ea\u884c\u66f4\u6362\u3002'} /> : <Space direction="vertical" size={10} style={{width:'100%'}}>
          <Alert type="info" showIcon message={'\u7533\u8bf7\u7ed1\u5b9a\u5f53\u524d\u8bbe\u5907'} description={'\u65e0\u9700\u586b\u5199\u624b\u673a\u53f7\u6216\u9009\u62e9\u8d26\u53f7\u3002\u7531\u8d85\u7ea7\u7ba1\u7406\u5458\u786e\u8ba4\u8bbe\u5907\u5e76\u7ed1\u5b9a\u771f\u5b9e\u8d26\u53f7\u3002'} />
          <Button type="primary" loading={pairingLoading} onClick={handleStartPairing}>{'\u7533\u8bf7\u7ed1\u5b9a\u5f53\u524d\u8bbe\u5907'}</Button>
          {pairing&&<Space wrap><span>\u8bbe\u5907\u914d\u5bf9\u7801\uff1a</span><Tag color="blue">{pairing.pairingCode}</Tag><Button loading={pairingLoading} onClick={handleRefreshPairing}>{'\u5237\u65b0\u6279\u51c6\u72b6\u6001'}</Button></Space>}
        </Space>}
      </Card>
      {/* 同步状态卡片 */}
      <Card
        title={
          <span>
            <SyncOutlined style={{ marginRight: 8 }} />
            CRDT 同步引擎
          </span>
        }
        extra={
          <Tag color={status.online ? 'green' : 'red'}>
            {status.online ? '在线' : '离线'}
          </Tag>
        }
        style={{ marginBottom: 16 }}
      >
        <Row gutter={24}>
          <Col span={8}>
            <Statistic
              title="待同步操作"
              value={status.pendingCount}
              suffix="条"
              valueStyle={{ color: status.pendingCount > 0 ? '#faad14' : '#52c41a' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="客户端 ID"
              value={eng.getClientId().substring(0, 16) + '...'}
              valueStyle={{ fontSize: 14 }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="上次同步"
              value={formatTime(status.lastSyncTime)}
              valueStyle={{ fontSize: 14 }}
            />
          </Col>
        </Row>

        <Divider />

        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="同步引擎版本">v1.5.0 (CRDT+LWW)</Descriptions.Item>
          <Descriptions.Item label="客户端标识">{eng.getClientId().substring(0, 8)}</Descriptions.Item>
          <Descriptions.Item label="冲突解决策略">Last-Writer-Wins + 字段级合并</Descriptions.Item>
          <Descriptions.Item label="向量时钟">
            <code>{JSON.stringify(eng.getVectorClock())}</code>
          </Descriptions.Item>
          <Descriptions.Item label="同步表" span={2}>
            {['students', 'courses', 'schedules', 'payments', 'consumptions', 'teachers', 'grades', 'rooms', 'institutions', 'assetRecords', 'questions'].join(', ')}
          </Descriptions.Item>
        </Descriptions>

        {status.pendingCount > 0 && (
          <Alert
            message={`有 ${status.pendingCount} 条待同步变更`}
            description="离线操作的变更尚未同步到服务端，请在联网后点击手动同步。"
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      {/* 操作面板 */}
      <Card title={<span><CloudSyncOutlined style={{ marginRight: 8 }} />同步控制</span>}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button
            type="primary"
            size="large"
            icon={<SyncOutlined />}
            loading={oneClickLoading}
            onClick={handleOneClickSync}
          >
            {oneClickText.oneClick}
          </Button>
          <Button
            icon={<CloudServerOutlined />}
            onClick={handleAuthorizedPush}
            disabled={status.pendingCount === 0}
          >
            申请同步权限并推送 ({status.pendingCount})
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handlePull}
          >
            只拉取主机数据
          </Button>
          <Button
            icon={<SyncOutlined />}
            onClick={handleSyncBoth}
          >
            双向同步
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleReset}
            style={{ marginLeft: 'auto' }}
          >
            重置引擎
          </Button>
        </div>
      </Card>

      {/* 同步协议说明 */}
      <Card
        title={<span><WarningOutlined style={{ marginRight: 8 }} />同步协议说明</span>}
        style={{ marginTop: 16 }}
        size="small"
      >
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
          <li><strong>CRDT 模式</strong>：所有操作以 Operation 为单元，独立存储向量时钟</li>
          <li><strong>离线优先</strong>：变更先写入本地，在线后异步推送到服务端</li>
          <li><strong>冲突解决</strong>：Last-Writer-Wins（LWW）+ 字段级别合并，避免整条覆盖</li>
          <li><strong>增量同步</strong>：仅传输有变更的字段，减少带宽消耗</li>
          <li><strong>分布式兼容</strong>：向量时钟支持多客户端同时修改（桌面端 + 小程序 + 管理员）</li>
        </ul>
      </Card>

      <Card
        title={<span><WarningOutlined style={{ marginRight: 8 }} />同步审核中心</span>}
        style={{ marginTop: 16 }}
        extra={<Button size="small" onClick={loadSyncConflicts}>刷新</Button>}
      >
        <Alert
          showIcon
          type={syncConflicts.length > 0 ? 'warning' : 'success'}
          message={syncConflicts.length > 0 ? `待审核冲突 ${syncConflicts.length} 条` : '暂无待审核同步冲突'}
          description="本地数据主机在这里审核高风险离线更改，避免客户端静默覆盖主机数据。"
          style={{ marginBottom: 12 }}
        />
        <Table
          size="small"
          rowKey="id"
          loading={conflictsLoading}
          dataSource={syncConflicts}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: '表', dataIndex: 'table_name', width: 110 },
            { title: '记录ID', dataIndex: 'record_id', ellipsis: true },
            { title: '设备ID', dataIndex: 'device_id', ellipsis: true },
            { title: '风险', dataIndex: 'risk_level', width: 90, render: (value: string) => <Tag color={value === 'high' ? 'red' : 'orange'}>{value || 'medium'}</Tag> },
            { title: '时间', dataIndex: 'created_at', width: 170 },
            {
              title: '操作',
              width: 230,
              render: (_: any, record: any) => (
                <Space size={4}>
                  <Button size="small" onClick={() => resolveConflict(record.id, 'host-wins')}>主机优先</Button>
                  <Button size="small" type="primary" onClick={() => resolveConflict(record.id, 'client-wins')}>客户端优先</Button>
                  <Button size="small" danger onClick={() => resolveConflict(record.id, 'reject')}>拒绝</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default SyncSettings;
