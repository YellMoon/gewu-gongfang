/**
 * 同步设置页面 v2 — CRDT 引擎同步状态 + 控制面板
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Tag, Descriptions, Divider, message, Modal, Statistic, Row, Col, Alert } from 'antd';
import { SyncOutlined, CloudSyncOutlined, CloudServerOutlined, WarningOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { SyncEngine, SyncStatus } from '../services/syncEngine';
import { pushSyncBatch, pullSyncOps } from '../services/syncApi';
import browserDatabase from '../services/browserDatabase';

const SyncSettings: React.FC = () => {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

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
  const handlePush = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    const pending = eng.getPendingOps();
    if (pending.length === 0) {
      message.info('没有待同步的变更');
      return;
    }

    message.loading({ content: '正在推送同步...', key: 'sync' });

    const result = await eng.push(pushSyncBatch);
    refreshStatus();

    if (result.success) {
      message.success({ content: `已推送 ${result.pushed} 条待同步变更`, key: 'sync' });
      (window as any).operateLogger?.log('同步', `手动推送 ${result.pushed} 条变更`, '云同步');
      return true;
    }

    message.error({ content: `推送失败，${pending.length} 条待同步变更已保留`, key: 'sync' });
    return false;
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
    const pushed = await handlePush();
    if (pushed === false) return;
    await handlePull();
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

  return (
    <div style={{ padding: 16 }}>
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
            icon={<CloudServerOutlined />}
            onClick={handlePush}
            disabled={status.pendingCount === 0}
          >
            推送变更 ({status.pendingCount})
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handlePull}
          >
            拉取云端变更
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
    </div>
  );
};

export default SyncSettings;
