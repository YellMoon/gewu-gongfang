/**
 * 云同步仪表盘 — 同步状态监控 + 手动同步控制
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Tag, Descriptions, Divider, message, Alert, Row, Col, Statistic, Modal } from 'antd';
import { SyncOutlined, CloudSyncOutlined, DeleteOutlined } from '@ant-design/icons';
import { SyncEngine, SyncStatus } from '../services/syncEngine';
import { getRuntimeConfig, RuntimeConfig } from '../services/runtimeConfigClient';
import browserDatabase from '../services/browserDatabase';
import { processMiniappCloudTasks, publishCloudHeartbeat, publishCloudSnapshot } from '../services/cloudRelayHostApi';
import { runOneClickSync } from '../services/oneClickSyncService.mjs';
import { createCloudRelaySyncTransport, createDirectSyncTransport, discoverLanDirectSyncTransports } from '../services/oneClickSyncTransports.mjs';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { resolveRenewableOnlineSyncActor } from '../services/pairingApiBase.mjs';
import { resolveManagedSyncConfig, syncFailureMessage } from '../services/managedSyncConfig.mjs';

const CloudSync: React.FC = () => {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [cloudPublishLoading, setCloudPublishLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    try {
      const syncEngine = new SyncEngine();
      engineRef.current = syncEngine;
      setEngine(syncEngine);
      setStatus(syncEngine.getStatus());
      setInitError(null);
    } catch (err: any) {
      setInitError(err?.message || '同步引擎初始化失败');
    }
  }, []);

  useEffect(() => {
    getRuntimeConfig()
      .then(setRuntimeConfig)
      .catch(() => setRuntimeConfig(null));
  }, []);

  const refreshStatus = useCallback(() => {
    if (engineRef.current) {
      setStatus(engineRef.current.getStatus());
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 5000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const formatActionSummary = (summary: any) => {
    const parts = [
      summary?.byAction?.create ? `\u65b0\u589e ${summary.byAction.create} \u6761` : '',
      summary?.byAction?.update ? `\u4fee\u6539 ${summary.byAction.update} \u6761` : '',
      summary?.byAction?.delete ? `\u5220\u9664 ${summary.byAction.delete} \u6761` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('\uff0c') : '\u65e0\u53d8\u66f4';
  };

  const confirmSyncPreview = (preview: any) => new Promise<boolean>((resolve) => {
    if (!preview.confirmationRequired) {
      resolve(true);
      return;
    }
    Modal.confirm({
      title: '\u786e\u8ba4\u5f00\u59cb\u540c\u6b65',
      width: 620,
      content: (
        <div style={{ lineHeight: 1.8 }}>
          <p>{preview.channel === 'direct' ? '\u901a\u9053\uff1a\u5c40\u57df\u7f51\u76f4\u8fde' : '\u901a\u9053\uff1a\u963f\u91cc\u4e91\u4e2d\u7ee7'}</p>
          <p><strong>{'\u672c\u673a\u5c06\u4e0a\u4f20\uff1a'}</strong>{`${preview.upload.total} \u6761\uff08${formatActionSummary(preview.upload)}\uff09`}</p>
          <p><strong>{'\u5c06\u4ece\u4e3b\u673a\u83b7\u53d6\uff1a'}</strong>{`${preview.download.total} \u6761\uff08${formatActionSummary(preview.download)}\uff09`}</p>
          <p><strong>{'\u9ad8\u98ce\u9669/\u5220\u9664\u9879\uff1a'}</strong>{`${preview.risk.high} \u6761`}</p>
          <p><strong>{'\u9884\u8ba1\u51b2\u7a81\uff1a'}</strong>{'0 \u6761\uff1b'}<strong>{'\u9884\u8ba1\u62d2\u7edd\uff1a'}</strong>{'0 \u6761'}</p>
        </div>
      ),
      okText: '\u5f00\u59cb\u540c\u6b65',
      cancelText: '\u53d6\u6d88',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

  const isLocalHostBase = (value?: string) => {
    const text = String(value || '').toLowerCase();
    return text.includes('127.0.0.1') || text.includes('localhost');
  };

  const handleStartSync = async () => {
    const eng = engineRef.current;
    if (!eng || syncLoading) return;
    setSyncLoading(true);
    try {
      const config: any = resolveManagedSyncConfig(runtimeConfig || await getRuntimeConfig());
      const requireOnlineSession = () => resolveRenewableOnlineSyncActor({
        readSession: () => readDesktopAuthorizationSession(),
        ensureOnline: () => (window as any).desktopIdentitySessionProvider?.ensureOnline?.(),
      });
      const transports = [];
      if (config?.cloudBaseUrl) {
        try {
          transports.push(...await discoverLanDirectSyncTransports({
            baseUrl: config.cloudBaseUrl,
            deviceId: eng.getDeviceId(),
            role: config.nodeRole || 'desktop-client',
            deviceName: config.deviceId || eng.getDeviceId(),
            desktopSyncToken: config.desktopSyncToken || '',
            sessionResolver: requireOnlineSession,
          }));
        } catch (_error) {
          // Cloud relay remains available when LAN discovery is unavailable.
        }
      }
      if (config?.hostBaseUrl && (config.nodeRole === 'primary-host' || !isLocalHostBase(config.hostBaseUrl))) {
        const direct = createDirectSyncTransport({
          baseUrl: config.hostBaseUrl,
          deviceId: eng.getDeviceId(),
          role: config.nodeRole || 'desktop-client',
          deviceName: config.deviceId || eng.getDeviceId(),
          sessionResolver: requireOnlineSession,
        });
        if (!transports.some((transport: any) => transport.baseUrl === direct.baseUrl)) transports.push(direct);
      }
      if (config?.cloudBaseUrl) {
        transports.push(createCloudRelaySyncTransport({
          baseUrl: config.cloudBaseUrl,
          deviceId: eng.getDeviceId(),
          desktopSyncToken: config.desktopSyncToken || '',
          sessionResolver: requireOnlineSession,
        }));
      }
      const result = await runOneClickSync({
        engine: eng,
        transports,
        confirmPreview: confirmSyncPreview,
        requireOnlineSession,
        buildLocalDataMaps: () => browserDatabase.buildSyncLocalDataMaps(),
        applyLocalDataMaps: (localData: any) => browserDatabase.applySyncLocalDataMaps(localData),
      });
      refreshStatus();
      const backupId = result.backupId ? String(result.backupId).slice(0, 12) : '';
      const backupText = backupId ? `\uff0c\u5907\u4efd ${backupId}` : '';
      if (result.status === 'synced') {
        message.success(`\u540c\u6b65\u5b8c\u6210\uff1a\u4e0a\u4f20 ${result.uploaded} \u6761\uff0c\u62c9\u53d6 ${result.downloaded} \u6761\uff0c\u51b2\u7a81 ${result.conflicts || 0} \u6761\uff0c\u62d2\u7edd ${result.rejected || 0} \u6761${backupText}`);
      } else if (result.status === 'needs-review') {
        message.warning(`\u540c\u6b65\u9700\u8981\u5904\u7406\uff0c\u672c\u673a\u961f\u5217\u5df2\u4fdd\u7559\uff1a\u51b2\u7a81 ${result.conflicts || 0} \u6761\uff0c\u62d2\u7edd ${result.rejected || 0} \u6761${backupText}`);
      } else if (result.status === 'waiting-host') {
        message.info(`\u540c\u6b65\u8bf7\u6c42\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u4e3b\u673a\u4e0a\u7ebf${result.requestId ? `\uff08${result.requestId}\uff09` : ''}`);
      } else if (result.status === 'cancelled') {
        message.info('\u5df2\u53d6\u6d88\u540c\u6b65\uff0c\u672c\u673a\u961f\u5217\u672a\u53d8\u66f4');
      } else {
        message.error(syncFailureMessage(result.error));
      }
    } catch (error: any) {
      refreshStatus();
      message.error(syncFailureMessage(error.code || error.message));
    } finally {
      setSyncLoading(false);
    }
  };

  const handlePublishCloudSnapshot = async () => {
    if (runtimeConfig?.nodeRole !== 'primary-host') {
      message.warning('只有本地数据主机可以发布云端快照');
      return;
    }
    setCloudPublishLoading(true);
    try {
      message.loading({ content: '正在发布云端快照...', key: 'cloud-snapshot' });
      const heartbeat = await publishCloudHeartbeat();
      const snapshot = await publishCloudSnapshot();
      const tasks = await processMiniappCloudTasks();
      if (snapshot.skipped) {
        message.warning({ content: snapshot.reason || '阿里云服务地址未配置，已跳过发布', key: 'cloud-snapshot' });
        return;
      }
      if (!snapshot.success) {
        throw new Error(snapshot.error || '云端快照发布失败');
      }
      const taskText = tasks?.success ? `，处理小程序任务 ${tasks.processed || 0} 个` : '';
      message.success({
        content: `云端快照已发布${heartbeat?.success ? '' : '（心跳未更新）'}${taskText}`,
        key: 'cloud-snapshot',
      });
      (window as any).operateLogger?.log('同步', '发布本地主机数据快照到阿里云', '云同步');
    } catch (error: any) {
      message.error({ content: error.message || '云端快照发布失败', key: 'cloud-snapshot' });
    } finally {
      setCloudPublishLoading(false);
    }
  };

  const handleReset = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.reset();
    refreshStatus();
    message.success('同步引擎已重置');
    (window as any).operateLogger?.log('设置', '重置同步引擎', '云同步');
  };

  const formatTime = (ts: number | null): string => {
    if (!ts) return '从未同步';
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  };

  if (initError) {
    return (
      <Card title={<span><CloudSyncOutlined style={{ marginRight: 8 }} />云同步</span>}>
        <Alert message="同步引擎初始化失败" description={initError} type="error" showIcon />
      </Card>
    );
  }

  if (!engine || !status) {
    return (
      <Card title={<span><CloudSyncOutlined style={{ marginRight: 8 }} />云同步</span>}>
        <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
          同步引擎初始化中...
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={<span><CloudSyncOutlined style={{ marginRight: 8 }} />云同步仪表盘</span>}
      extra={<Tag color={status.online ? 'green' : 'red'}>{status.online ? '在线' : '离线'}</Tag>}
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
            title="同步状态"
            value={status.lastSyncResult === 'success' ? '上次成功' : status.lastSyncResult === 'error' ? '上次失败' : '未同步'}
            valueStyle={{ fontSize: 14 }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="上次同步时间"
            value={formatTime(status.lastSyncTime)}
            valueStyle={{ fontSize: 14 }}
          />
        </Col>
      </Row>

      <Divider />

      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="客户端ID">
          {engine.getClientId().substring(0, 16)}...
        </Descriptions.Item>
        <Descriptions.Item label="冲突策略">LWW + 字段级合并</Descriptions.Item>
        <Descriptions.Item label="向量时钟">
          <code>{JSON.stringify(engine.getVectorClock())}</code>
        </Descriptions.Item>
        <Descriptions.Item label="待同步队列">
          {status.pendingCount} 条
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

      <Divider>同步控制</Divider>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button type="primary" icon={<SyncOutlined />} onClick={handleStartSync} loading={syncLoading}>
          {'\u5f00\u59cb\u540c\u6b65'}
        </Button>
        <Button
          icon={<CloudSyncOutlined />}
          onClick={handlePublishCloudSnapshot}
          loading={cloudPublishLoading}
          disabled={runtimeConfig?.nodeRole !== 'primary-host'}
        >
          发布云端快照
        </Button>
        <Button danger icon={<DeleteOutlined />} onClick={handleReset} style={{ marginLeft: 'auto' }}>
          重置引擎
        </Button>
      </div>
      {runtimeConfig?.nodeRole !== 'primary-host' && (
        <Alert
          message="当前不是本地数据主机"
          description="普通离线客户端请先同步到本地数据主机，再由主机发布云端快照，小程序会读取最近一次发布的数据。"
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  );
};

export default CloudSync;
