import React from 'react';
import { Alert, Button, Descriptions, Empty, Popconfirm, Space, Tag } from 'antd';
const { authorityDraftError } = require('./authorityDraftPresentation');
export const openDesktopSync = () => window.dispatchEvent(new Event('desktop-sync-open'));

export const PendingChangesPanel: React.FC<{ state: any; onDiscard: (id: string) => void }> = ({ state, onDiscard }) => {
  const conflicts = state.items.some((item: any) => item.status === 'conflict');
  return <div className="desktop-sync-content">
    <p className="desktop-sync-explanation">{state.online
      ? '\u8054\u7f51\u4fee\u6539\u4f1a\u81ea\u52a8\u63d0\u4ea4\u3002\u79bb\u7ebf\u4fee\u6539\u5728\u8fd9\u91cc\u4e00\u6b21\u786e\u8ba4\u3002'
      : '\u5f53\u524d\u79bb\u7ebf\uff0c\u4fee\u6539\u5df2\u4fdd\u5b58\u5728\u672c\u673a\u3002\u8054\u7f51\u540e\u53ef\u6574\u4f53\u63d0\u4ea4\u3002'}</p>
    {(state.error || conflicts) && <Alert showIcon type="warning" style={{ marginBottom: 16 }}
      message={state.error ? authorityDraftError(state.error) : '\u5b58\u5728\u51b2\u7a81\uff0c\u81ea\u52a8\u63d0\u4ea4\u5df2\u6682\u505c'}
      description={conflicts ? '\u8bf7\u5148\u5904\u7406\u51b2\u7a81\u3002\u653e\u5f03\u672c\u5730\u66f4\u6539\u540e\uff0c\u53ef\u57fa\u4e8e\u4e91\u7aef\u6700\u65b0\u6570\u636e\u91cd\u65b0\u7f16\u8f91\u3002' : undefined} />}
    {!state.items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u5f53\u524d\u6ca1\u6709\u5f85\u540c\u6b65\u7684\u66f4\u6539'} />
      : <div role="list" aria-label={'\u5f85\u540c\u6b65\u7684\u66f4\u6539'}>{state.items.map((item: any, index: number) => {
        const presentation = state.descriptions[item.id] || { title: '\u5f85\u63d0\u4ea4\u7684\u66f4\u6539', summary: '', details: [] };
        const failed = item.status === 'conflict';
        return <section role="listitem" className="desktop-sync-item" key={item.id} data-row-key={item.id}>
          <div className="desktop-sync-item-heading"><strong>{index + 1}. {presentation.title}</strong>
            <Tag color={failed ? 'error' : item.status === 'awaiting_confirmation' ? 'gold' : 'processing'}>
              {failed ? '\u9700\u8981\u5904\u7406' : item.status === 'completed' ? '\u9644\u4ef6\u5f85\u6838\u9a8c'
                : item.status === 'awaiting_confirmation' ? '\u5f85\u63d0\u4ea4' : '\u5df2\u786e\u8ba4\uff0c\u5f85\u5b8c\u6210'}</Tag></div>
          <p>{presentation.summary}</p>
          {!!presentation.details?.length && <details><summary>{'\u67e5\u770b\u66f4\u6539\u5185\u5bb9'}</summary>
            <Descriptions size="small" column={1}>{presentation.details.map((detail: any, index: number) =>
              <Descriptions.Item key={index} label={detail.label}>{detail.value}</Descriptions.Item>)}</Descriptions>
          </details>}
          {item.status !== 'completed' && <Space wrap className="desktop-sync-item-issue">
            {(failed || presentation.blocked) && <span>{authorityDraftError(item.conflict?.code || 'AUTHORITY_DRAFT_TARGET_UNAVAILABLE')}</span>}
            <Popconfirm title={'\u653e\u5f03\u8fd9\u6761\u672c\u5730\u66f4\u6539\uff1f'}
              okButtonProps={{ disabled: state.busy }}
              description={item.status === 'submitted'
                ? '移除本机待同步记录并停止后续重试；已提交到云端的操作不会撤销。'
                : '本机草稿将被移除，不会删除云端课程或其他业务数据。'}
              okText={'\u653e\u5f03\u66f4\u6539'} cancelText={'\u7ee7\u7eed\u4fdd\u7559'} onConfirm={() => onDiscard(item.id)}>
              <Button danger disabled={state.busy}>{'\u653e\u5f03\u8fd9\u6761\u66f4\u6539'}</Button></Popconfirm>
          </Space>}
        </section>;
      })}</div>}
  </div>;
};
const AuthorityOutboxPanel: React.FC<{ compact?: boolean; focus?: 'issues' | 'pending' }> = () =>
  <Button onClick={openDesktopSync}>{'\u6253\u5f00\u4e91\u540c\u6b65'}</Button>;
export default AuthorityOutboxPanel;
