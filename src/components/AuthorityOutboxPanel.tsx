import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Modal, Space, Statistic, Table, Tag, message } from 'antd';
import { CheckCircleOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { getQuestionAssetDataUrl, assetKeyFromRef } from '../services/questionAssetStore';

const { createDesktopQuestionImportClient } = require('../services/desktopQuestionImportClient.mjs');

type AuthorityOutboxItem = {
  id: string;
  type: string;
  payload?: Record<string, any>;
  preview?: Record<string, unknown>;
  status: 'awaiting_confirmation' | 'confirmed' | 'submitted' | 'completed' | 'conflict';
  submission?: { transportUsed?: string } | null;
  receipt?: any;
  conflict?: { code?: string } | null;
};

type Props = {
  compact?: boolean;
  focus?: 'issues' | 'pending';
};

const copy = {
  title: '\u4e91\u7aef\u6743\u5a01\u6570\u636e\u540c\u6b65',
  refresh: '\u5237\u65b0',
  waitConfirm: '\u7b49\u5f85\u786e\u8ba4',
  confirmed: '\u5df2\u786e\u8ba4\uff0c\u5f85\u53d1\u9001',
  waitReceipt: '\u7b49\u5f85\u4e91\u7aef\u56de\u6267',
  completed: '\u5df2\u5b8c\u6210',
  issue: '\u9700\u8981\u5904\u7406',
  modalTitle: '\u786e\u8ba4\u63d0\u4ea4\u5230\u4e91\u7aef\u6743\u5a01\u6570\u636e',
  commandType: '\u547d\u4ee4\u7c7b\u578b',
  preview: '\u5f71\u54cd\u9884\u89c8',
  safety: '\u5b89\u5168\u8bf4\u660e',
  safetyText: '\u786e\u8ba4\u540e\u624d\u4f1a\u53d1\u9001\uff1b\u4e91\u7aef\u5c06\u91cd\u65b0\u6821\u9a8c\u684c\u9762\u4f1a\u8bdd\u3001\u8bbe\u5907\u3001\u89d2\u8272\u548c\u5b57\u6bb5\u8303\u56f4\u3002',
  confirm: '\u786e\u8ba4\u5e76\u53d1\u9001',
  keep: '\u7ee7\u7eed\u4fdd\u7559\u8349\u7a3f',
  retry: '\u91cd\u8bd5\u540c\u4e00\u547d\u4ee4',
  retained: '\u4fdd\u7559\uff0c\u7b49\u5f85\u5904\u7406',
  state: '\u72b6\u6001',
  transport: '\u4f20\u8f93 / \u6295\u5f71',
  actions: '\u64cd\u4f5c',
  conflictMessage: '\u5b58\u5728\u56de\u6267\u51b2\u7a81\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559',
  empty: '\u5f53\u524d\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u6743\u5a01\u547d\u4ee4',
  assetVerificationPending: '\u9898\u5e93\u5bcc\u5a92\u4f53\u5df2\u8fdb\u5165 NAS \u6838\u9a8c\u961f\u5217\uff0c\u672a\u901a\u8fc7\u5b8c\u6574\u6027\u56de\u6267\u524d\u4e0d\u89c6\u4e3a\u5b8c\u6210\u3002',
  assetVerified: '\u9898\u5e93\u5bcc\u5a92\u4f53\u5df2\u901a\u8fc7 NAS \u5b8c\u6574\u6027\u6838\u9a8c',
  questionTextCommitted: '\u9898\u5e93\u6587\u5b57\u5df2\u7531\u4e91\u7aef\u63d0\u4ea4\uff1b\u5bcc\u5a92\u4f53\u6b63\u5728\u7b49\u5f85 NAS \u5b8c\u6574\u6027\u6838\u9a8c',
};

function requireBridge() {
  if (!window.desktopAuthority) throw new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE');
  return window.desktopAuthority;
}

function statusTag(item: AuthorityOutboxItem) {
  if (item.status === 'awaiting_confirmation') return <Tag color="gold">{copy.waitConfirm}</Tag>;
  if (item.status === 'confirmed') return <Tag color="blue">{copy.confirmed}</Tag>;
  if (item.status === 'submitted') return <Tag color="processing">{copy.waitReceipt}</Tag>;
  if (item.status === 'completed' && hasPendingQuestionAssetVerification(item)) {
    return <Tag color="processing">{copy.assetVerificationPending}</Tag>;
  }
  if (item.status === 'completed') return <Tag color="success">{copy.completed}</Tag>;
  return <Tag color="error">{copy.issue}</Tag>;
}

function previewText(item: AuthorityOutboxItem) {
  const preview = item.preview || {};
  return String(preview.title || preview.summary || item.type);
}

function cloudDraftSubmissionInput(item: AuthorityOutboxItem) {
  if (!/^(question|student|course|schedule|teacher|room|institution|school|payment|consumption|grade|personal-asset-record|personal-asset-category)\.(create|update|delete)\.v\d+$/.test(item.type)) return undefined;
  const authorization = readDesktopAuthorizationSession().authorization;
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match) throw new Error('DESKTOP_CLOUD_SESSION_REQUIRED');
  return { sessionToken: match[1] };
}

type AssetRelayState = {
  assetId: string;
  taskId: string;
  objectId: string;
  objectVersion: number;
  status: 'queued' | 'verified' | 'failed';
  updatedAt: string;
  errorCode?: string;
};

const assetRelayStatePrefix = 'gewu.question-asset-relay.v1:';

function questionIdForRelay(item: AuthorityOutboxItem, receipt: any): string {
  const fromReceipt = receipt?.result?.id;
  const payload = item.payload || {};
  const fromPayload = item.type === 'question.create.v1' ? payload?.record?.id : payload?.id;
  const id = String(fromReceipt || fromPayload || '').trim();
  if (!id || id.length > 128) throw new Error('QUESTION_ASSET_RELAY_QUESTION_INVALID');
  return id;
}

function questionAssetKeys(value: unknown): string[] {
  const keys = new Set<string>();
  const seen = new Set<object>();
  const walk = (current: any) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/question-asset:\/\/([A-Za-z0-9._-]{1,512})/g)) keys.add(assetKeyFromRef(match[0]));
      return;
    }
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) current.forEach(walk);
    else Object.values(current).forEach(walk);
  };
  walk(value);
  return [...keys].sort();
}

function hasPendingQuestionAssetVerification(item: AuthorityOutboxItem): boolean {
  if (!/^question\.(create|update)\.v\d+$/.test(item.type)) return false;
  const keys = questionAssetKeys(item.payload || {});
  if (!keys.length) return false;
  let questionId = '';
  try {
    questionId = questionIdForRelay(item, item.receipt);
  } catch (_error) {
    return true;
  }
  return keys.some(assetKey => {
    try {
      const stored = localStorage.getItem(assetRelayStateKey(questionId, assetKey));
      const state = stored ? JSON.parse(stored) as AssetRelayState : null;
      return state?.status !== 'verified';
    } catch (_error) {
      return true;
    }
  });
}

function assetRelayStateKey(questionId: string, assetKey: string): string {
  return `${assetRelayStatePrefix}${encodeURIComponent(questionId)}:${encodeURIComponent(assetKey)}`;
}

async function refreshQuestionAssetVerification(items: AuthorityOutboxItem[]): Promise<boolean> {
  let changed = false;
  for (const item of items) {
    if (item.status !== 'completed' || !hasPendingQuestionAssetVerification(item)) continue;
    let questionId = '';
    try {
      questionId = questionIdForRelay(item, item.receipt);
    } catch (_error) {
      continue;
    }
    for (const assetKey of questionAssetKeys(item.payload || {})) {
      const stateKey = assetRelayStateKey(questionId, assetKey);
      let state: AssetRelayState | null = null;
      try {
        state = JSON.parse(localStorage.getItem(stateKey) || 'null') as AssetRelayState | null;
      } catch (_error) {
        state = null;
      }
      if (state?.status !== 'queued') continue;
      try {
        const remote = await createDesktopQuestionImportClient().readAssetRelay(state.taskId);
        if (remote.state === 'verified') {
          localStorage.setItem(stateKey, JSON.stringify({
            ...state,
            status: 'verified',
            updatedAt: new Date().toISOString(),
            errorCode: undefined,
          }));
          changed = true;
        }
      } catch (_error) {
        // Polling must never turn a read failure into a new media upload.
      }
    }
  }
  return changed;
}

function freshRelayId(prefix: 'asset' | 'task' | 'obj'): string {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random()}`.replace(/[^A-Za-z0-9]/g, '');
  return `${prefix}_${raw.slice(0, 120)}`;
}

async function dataUrlBytes(dataUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) throw new Error('QUESTION_ASSET_RELAY_SOURCE_UNAVAILABLE');
  const mimeType = String(match[1] || 'application/octet-stream').split(';')[0];
  const payload = match[3] || '';
  let bytes: Uint8Array;
  try {
    if (match[2]) {
      const binary = atob(payload.replace(/\s/g, ''));
      bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
  } catch (_error) {
    throw new Error('QUESTION_ASSET_RELAY_SOURCE_INVALID');
  }
  if (!bytes.byteLength || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+/-]{0,254}$/.test(mimeType)) throw new Error('QUESTION_ASSET_RELAY_SOURCE_INVALID');
  return { bytes, mimeType };
}

async function relayQuestionAssetsAfterReceipt(item: AuthorityOutboxItem, receipt: any): Promise<number> {
  if (!/^question\.(create|update)\.v\d+$/.test(item.type) || receipt?.status !== 'committed') return 0;
  const questionId = questionIdForRelay(item, receipt);
  const keys = questionAssetKeys(item.payload || {});
  let queued = 0;
  for (const assetKey of keys) {
    const stateKey = assetRelayStateKey(questionId, assetKey);
    let state: AssetRelayState | null = null;
    try {
      state = JSON.parse(localStorage.getItem(stateKey) || 'null') as AssetRelayState | null;
    } catch (_error) {
      state = null;
    }
    if (state?.status === 'verified') continue;
    const client = createDesktopQuestionImportClient();
    if (state?.status === 'queued') {
      const remote = await client.readAssetRelay(state.taskId);
      if (remote.state === 'verified') {
        localStorage.setItem(stateKey, JSON.stringify({ ...state, status: 'verified', updatedAt: new Date().toISOString(), errorCode: undefined }));
        continue;
      }
      if (remote.state === 'queued' || remote.state === 'leased') {
        queued += 1;
        continue;
      }
      state = { ...state, status: 'failed', updatedAt: new Date().toISOString(), errorCode: `QUESTION_ASSET_RELAY_${remote.state.toUpperCase()}` };
      localStorage.setItem(stateKey, JSON.stringify(state));
    }
    const nextState: AssetRelayState = state && state.status !== 'failed' && state.assetId && state.taskId && state.objectId
      ? { ...state, status: 'failed', updatedAt: new Date().toISOString() }
      : { assetId: freshRelayId('asset'), taskId: freshRelayId('task'), objectId: freshRelayId('obj'), objectVersion: 1, status: 'failed', updatedAt: new Date().toISOString() };
    try {
      const dataUrl = await getQuestionAssetDataUrl(assetKey);
      const source = await dataUrlBytes(dataUrl);
      await client.relayAsset({
        questionId, assetId: nextState.assetId, assetType: source.mimeType.startsWith('image/') ? 'image' : 'attachment',
        fileName: `${assetKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 480) || 'asset'}.bin`, mimeType: source.mimeType,
        bytes: source.bytes, storage: { taskId: nextState.taskId, objectId: nextState.objectId, objectVersion: nextState.objectVersion },
      });
      localStorage.setItem(stateKey, JSON.stringify({ ...nextState, status: 'queued', updatedAt: new Date().toISOString(), errorCode: undefined }));
      queued += 1;
    } catch (error: any) {
      localStorage.setItem(stateKey, JSON.stringify({ ...nextState, status: 'failed', updatedAt: new Date().toISOString(), errorCode: error?.code || error?.message || 'QUESTION_ASSET_RELAY_FAILED' }));
      throw error;
    }
  }
  return queued;
}

const AuthorityOutboxPanel: React.FC<Props> = ({ compact = false, focus }) => {
  const [items, setItems] = useState<AuthorityOutboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const listed = await requireBridge().list();
      const next = Array.isArray(listed) ? listed : [];
      await refreshQuestionAssetVerification(next);
      setItems([...next]);
      setErrorCode('');
    } catch (error: any) {
      setErrorCode(error?.code || error?.message || 'AUTHORITY_OUTBOX_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const counts = useMemo(() => ({
    confirmation: items.filter(item => item.status === 'awaiting_confirmation').length,
    pending: items.filter(item => ['confirmed', 'submitted'].includes(item.status)
      || hasPendingQuestionAssetVerification(item)).length,
    issues: items.filter(item => item.status === 'conflict').length,
    completed: items.filter(item => item.status === 'completed' && !hasPendingQuestionAssetVerification(item)).length,
  }), [items]);

  const confirmAndSubmit = (item: AuthorityOutboxItem) => {
    Modal.confirm({
      title: copy.modalTitle,
      width: 560,
      content: (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={copy.commandType}>{item.type}</Descriptions.Item>
          <Descriptions.Item label={copy.preview}>{previewText(item)}</Descriptions.Item>
          <Descriptions.Item label={copy.safety}>{copy.safetyText}</Descriptions.Item>
        </Descriptions>
      ),
      okText: copy.confirm,
      cancelText: copy.keep,
      onOk: async () => {
        setBusyId(item.id);
        try {
          const result = await requireBridge().confirmAndSubmit(item.id, cloudDraftSubmissionInput(item));
          if (result.receipt?.status === 'rejected') {
            message.error(result.receipt?.result?.error?.code || 'AUTHORITY_COMMAND_REJECTED');
          } else {
            message.success(`${hasPendingQuestionAssetVerification(item) ? copy.questionTextCommitted : copy.completed} (${result.transportUsed})`);
            await (window as any).dbService?.refreshAuthorityProjection?.({
              minSourceVersion: result.receipt?.projectionVersion || 0,
            });
            try {
              await relayQuestionAssetsAfterReceipt(item, result.receipt);
            } catch (error: any) {
              message.warning(error?.code || error?.message || 'QUESTION_ASSET_RELAY_PENDING');
            }
          }
        } catch (error: any) {
          message.error(error?.code || error?.message || 'AUTHORITY_COMMAND_SUBMIT_FAILED');
        } finally {
          setBusyId('');
          await refresh();
        }
      },
    });
  };

  const retry = async (item: AuthorityOutboxItem) => {
    setBusyId(item.id);
    try {
      const result = await requireBridge().submit(item.id, cloudDraftSubmissionInput(item));
      if (result) {
        if (result.receipt?.status === 'rejected') {
          message.error(result.receipt?.result?.error?.code || 'AUTHORITY_COMMAND_REJECTED');
        } else {
          message.success(`${hasPendingQuestionAssetVerification(item) ? copy.questionTextCommitted : copy.completed} (${result.transportUsed})`);
          await (window as any).dbService?.refreshAuthorityProjection?.({
            minSourceVersion: result.receipt?.projectionVersion || 0,
          });
          try {
            await relayQuestionAssetsAfterReceipt(item, result.receipt);
          } catch (error: any) {
            message.warning(error?.code || error?.message || 'QUESTION_ASSET_RELAY_PENDING');
          }
        }
      }
    } catch (error: any) {
      message.error(error?.code || error?.message || 'AUTHORITY_COMMAND_RETRY_FAILED');
    } finally {
      setBusyId('');
      await refresh();
    }
  };

  const retryQuestionAssets = async (item: AuthorityOutboxItem) => {
    setBusyId(item.id);
    try {
      const queued = await relayQuestionAssetsAfterReceipt(item, item.receipt);
      if (queued) message.info(copy.assetVerificationPending);
      else message.success(copy.assetVerified);
    } catch (error: any) {
      message.error(error?.code || error?.message || 'QUESTION_ASSET_RELAY_PENDING');
    } finally {
      setBusyId('');
      await refresh();
    }
  };

  const visibleItems = focus === 'issues'
    ? items.filter(item => item.status === 'conflict')
    : focus === 'pending'
      ? items.filter(item => item.status !== 'completed' || hasPendingQuestionAssetVerification(item))
      : items;

  const columns = [
    { title: copy.state, width: 140, render: (_: unknown, item: AuthorityOutboxItem) => statusTag(item) },
    {
      title: copy.preview,
      render: (_: unknown, item: AuthorityOutboxItem) => (
        <div><div>{previewText(item)}</div><small>{item.type}</small></div>
      ),
    },
    {
      title: copy.transport,
      width: 180,
      render: (_: unknown, item: AuthorityOutboxItem) => (
        <div>
          <div>{item.submission?.transportUsed !== 'pending' ? item.submission?.transportUsed || '--' : '--'}</div>
          <small>{Number.isSafeInteger(item.receipt?.projectionVersion)
            ? `projection v${item.receipt?.projectionVersion}` : item.conflict?.code || ''}</small>
        </div>
      ),
    },
    {
      title: copy.actions,
      width: 170,
      render: (_: unknown, item: AuthorityOutboxItem) => {
        if (item.status === 'awaiting_confirmation') {
          return <Button type="primary" size="small" loading={busyId === item.id}
            onClick={() => confirmAndSubmit(item)}>{copy.preview}</Button>;
        }
        if (item.status === 'confirmed' || item.status === 'submitted') {
          return <Button size="small" loading={busyId === item.id}
            onClick={() => void retry(item)}>{copy.retry}</Button>;
        }
        return item.status === 'completed'
          ? (/^question\.(create|update)\.v\d+$/.test(item.type)
            ? <Button size="small" loading={busyId === item.id}
              onClick={() => void retryQuestionAssets(item)}>{copy.retry}</Button>
            : <CheckCircleOutlined style={{ color: '#52c41a' }} />)
          : <span style={{ color: '#cf1322' }}>{copy.retained}</span>;
      },
    },
  ];

  return (
    <Card title={<span><SafetyCertificateOutlined /> {copy.title}</span>}
      extra={<Button icon={<ReloadOutlined />} loading={loading}
        onClick={() => void refresh()}>{copy.refresh}</Button>}>
      {(errorCode || counts.issues > 0) && <Alert type={errorCode ? 'error' : 'warning'} showIcon
        message={errorCode || copy.conflictMessage} style={{ marginBottom: 16 }} />}
      <Space size="large" wrap style={{ marginBottom: 20 }}>
        <Statistic title={copy.waitConfirm} value={counts.confirmation} />
        <Statistic title={copy.waitReceipt} value={counts.pending} />
        <Statistic title={copy.issue} value={counts.issues} />
        {!compact && <Statistic title={copy.completed} value={counts.completed} />}
      </Space>
      {visibleItems.length === 0
        ? <Empty description={copy.empty} />
        : <Table rowKey="id" size={compact ? 'small' : 'middle'}
          pagination={{ pageSize: compact ? 5 : 10 }} columns={columns} dataSource={visibleItems} />}
    </Card>
  );
};

export default AuthorityOutboxPanel;
