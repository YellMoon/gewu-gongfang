/**
 * 云同步仪表盘 — 同步状态监控 + 手动同步控制
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Tag, Descriptions, Divider, message, Alert, Row, Col, Statistic, Modal } from 'antd';
import { SyncOutlined, CloudSyncOutlined, CloudServerOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { SyncEngine, SyncStatus } from '../services/syncEngine';
import { pushSyncBatch, pullSyncOps, registerSyncDevice, requestSyncAuthorization } from '../services/syncApi';
import { getRuntimeConfig, RuntimeConfig } from '../services/runtimeConfigClient';
import browserDatabase from '../services/browserDatabase';

const CloudSync: React.FC = () => {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
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

  const handlePush = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    const pending = eng.getPendingOps();
    if (pending.length === 0) {
      message.info('没有待同步的变更');
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

            if (result.success) {
              message.success({ content: `已推送 ${result.pushed} 条离线更改`, key: 'sync' });
              (window as any).operateLogger?.log('同步', `申请同步权限并推送 ${result.pushed} 条离线更改`, '云同步');
              resolve(true);
              return;
            }

            message.error({ content: `推送失败，${pending.length} 条离线更改已保留`, key: 'sync' });
            resolve(false);
          } catch (error: any) {
            refreshStatus();
            message.error({ content: error.message || '申请同步权限失败', key: 'sync' });
            resolve(false);
          }
        },
      });
    });
  };

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
    const pushed = await handlePush();
    if (pushed === false) return;
    await handlePull();
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
        <Button type="primary" icon={<CloudServerOutlined />} onClick={handlePush} disabled={status.pendingCount === 0}>
          推送变更 ({status.pendingCount})
        </Button>
        <Button icon={<ReloadOutlined />} onClick={handlePull}>
          拉取云端变更
        </Button>
        <Button icon={<SyncOutlined />} onClick={handleSyncBoth}>
          双向同步
        </Button>
        <Button danger icon={<DeleteOutlined />} onClick={handleReset} style={{ marginLeft: 'auto' }}>
          重置引擎
        </Button>
      </div>
    </Card>
  );
};

export default CloudSync;
