import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, message } from 'antd';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { resolvePairingApiBase } from '../services/pairingApiBase.mjs';

export default function PairingReviewPanel({ users = [] }: { users?: any[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [available, setAvailable] = useState(true);
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string>>({});

  const request = async (path: string, method = 'GET', body?: any) => {
    const session = readDesktopAuthorizationSession();
    const baseUrl = resolvePairingApiBase(await getRuntimeConfig(), window.location);
    const response = await fetch(`${baseUrl}/api/desktop-pairing${path}`, {
      method,
      headers: { Authorization: session.authorization, 'x-device-id': session.authContext.deviceId, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 403) { setAvailable(false); return null; }
    return response.json();
  };
  const load = async () => {
    const data = await request(`/pending?code=${encodeURIComponent(code)}`);
    if (data?.success) setItems(data.items || []);
  };
  const review = async (pairingCode: string, action: 'approve' | 'reject') => {
    const userId = selectedUsers[pairingCode];
    if (action === 'approve' && !userId) { message.warning('\u8bf7\u5148\u9009\u62e9\u8981\u7ed1\u5b9a\u7684\u771f\u5b9e\u8d26\u53f7'); return; }
    const data = await request(`/code/${pairingCode}/${action}`, 'POST', action === 'approve' ? { userId } : {});
    if (data?.success) { message.success('\u8bbe\u5907\u5ba1\u6279\u5df2\u66f4\u65b0'); await load(); }
  };
  useEffect(() => { load().catch(() => setAvailable(false)); }, []);
  if (!available) return null;
  return <Card title={'\u5f85\u5ba1\u6279\u8bbe\u5907'} style={{ marginBottom: 16 }} extra={<Space><Input value={code} onChange={e => setCode(e.target.value)} placeholder={'\u914d\u5bf9\u7801'} /><Button onClick={load}>{'\u67e5\u8be2'}</Button></Space>}>
    <Alert type="info" showIcon message={'\u666e\u901a\u7535\u8111\u4e0d\u80fd\u9009\u62e9\u8d26\u53f7\u3002\u8bf7\u6838\u5bf9\u8bbe\u5907\u4e0e\u914d\u5bf9\u7801\uff0c\u518d\u7531\u8d85\u7ea7\u7ba1\u7406\u5458\u7ed1\u5b9a\u771f\u5b9e\u7528\u6237\u3002'} style={{ marginBottom: 12 }} />
    <Table rowKey="id" dataSource={items} pagination={false} columns={[{ title: '\u914d\u5bf9\u7801', dataIndex: 'pairingCode' }, { title: '\u8bbe\u5907', dataIndex: 'deviceName' }, { title: '\u7ed1\u5b9a\u8d26\u53f7', render: (_, row) => <Select aria-label="\u9009\u62e9\u8bbe\u5907\u7ed1\u5b9a\u8d26\u53f7" value={selectedUsers[row.pairingCode]} onChange={userId => setSelectedUsers(current => ({...current,[row.pairingCode]:userId}))} style={{minWidth:180}} options={users.filter(user => user.review_status === 'approved' && !user.disabled).map(user => ({value:user.id,label:user.name || user.nickname || user.id}))} placeholder="\u9009\u62e9\u771f\u5b9e\u8d26\u53f7" /> }, { title: '\u64cd\u4f5c', render: (_, row) => <Space><Button type="primary" disabled={!selectedUsers[row.pairingCode]} onClick={() => review(row.pairingCode, 'approve')}>\u6279\u51c6\u5e76\u7ed1\u5b9a</Button><Button danger onClick={() => review(row.pairingCode, 'reject')}>\u62d2\u7edd</Button></Space> }]} />
  </Card>;
}
