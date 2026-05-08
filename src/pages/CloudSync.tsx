/**
 * 云同步仪表盘 — 同步状态监控 + 手动同步控制
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Tag, Descriptions, Divider, message, Alert, Row, Col, Statistic } from 'antd';
import { SyncOutlined, CloudSyncOutlined, CloudServerOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { SyncEngine, SyncStatus } from '../services/syncEngine';

const CloudSync: React.FC = () => {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
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
    eng.clearPending();
    refreshStatus();
    message.success(`已清除 ${pending.length} 条待同步变更（演示模式）`);
    (window as any).operateLogger?.log('同步', `手动推送 ${pending.length} 条变更`, '云同步');
  };

  const handlePull = async () => {
    message.loading({ content: '正在拉取云端变更...', key: 'pull' });
    setTimeout(() => {
      message.success({ content: '拉取完成（演示模式）', key: 'pull' });
      (window as any).operateLogger?.log('同步', '手动拉取云端变更', '云同步');
    }, 1000);
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
        <Button icon={<SyncOutlined />} onClick={() => { handlePush(); handlePull(); }}>
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
