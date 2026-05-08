import React from 'react';
import { Card, Button, Result } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';

const SyncNow: React.FC = () => {
  return (
    <Card title="☁️ 手动同步" style={{ margin: 16 }}>
      <Result
        icon={<CloudDownloadOutlined />}
        title="手动同步功能"
        subTitle="点击下方按钮立即同步数据到云端"
        extra={<Button type="primary" icon={<CloudDownloadOutlined />}>立即同步</Button>}
      />
    </Card>
  );
};

export default SyncNow;
