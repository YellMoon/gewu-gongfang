import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Space, Table, message } from 'antd';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { resolvePairingApiBase } from '../services/pairingApiBase.mjs';

export default function PairingReviewPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [available, setAvailable] = useState(true);

  const request = async (path: string, method = 'GET') => {
    const session = readDesktopAuthorizationSession();
    const baseUrl = resolvePairingApiBase(await getRuntimeConfig(), window.location);
    const response = await fetch(`${baseUrl}/api/desktop-pairing${path}`, {
      method,
      headers: { Authorization: session.authorization, 'x-device-id': session.authContext.deviceId },
    });
    if (response.status === 403) { setAvailable(false); return null; }
    return response.json();
  };
  const load = async () => {
    const data = await request(`/pending?code=${encodeURIComponent(code)}`);
    if (data?.success) setItems(data.items || []);
  };
  const review = async (pairingCode: string, action: 'approve' | 'reject') => {
    const data = await request(`/code/${pairingCode}/${action}`, 'POST');
    if (data?.success) { message.success('\u8bbe\u5907\u5ba1\u6279\u5df2\u66f4\u65b0'); await load(); }
  };
  useEffect(() => { load().catch(() => setAvailable(false)); }, []);
  if (!available) return null;
  return <Card title={'\u5f85\u5ba1\u6279\u8bbe\u5907'} style={{ marginBottom: 16 }} extra={<Space><Input value={code} onChange={e => setCode(e.target.value)} placeholder={'\u914d\u5bf9\u7801'} /><Button onClick={load}>{'\u67e5\u8be2'}</Button></Space>}>
    <Alert type="info" showIcon message={'\u9996\u6b21\u914d\u5bf9\u8bf7\u7531\u5df2\u9a8c\u8bc1\u624b\u673a\u53f7\u7684\u5c0f\u7a0b\u5e8f\u8d85\u7ea7\u7ba1\u7406\u5458\u5ba1\u6279\uff1b\u4e0d\u5f00\u653e HTTP bootstrap\u3002'} style={{ marginBottom: 12 }} />
    <Table rowKey="id" dataSource={items} pagination={false} columns={[{ title: 'Code', dataIndex: 'pairingCode' }, { title: 'Device', dataIndex: 'deviceName' }, { title: 'Phone', dataIndex: 'phone' }, { title: 'Action', render: (_, row) => <Space><Button type="primary" onClick={() => review(row.pairingCode, 'approve')}>Approve</Button><Button danger onClick={() => review(row.pairingCode, 'reject')}>Reject</Button></Space> }]} />
  </Card>;
}
