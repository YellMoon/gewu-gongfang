import React from 'react';
import { Alert, Card } from 'antd';
import PairingReviewPanel from '../components/PairingReviewPanel';

const PermissionManager: React.FC = () => (
  <div style={{ padding: 20 }}>
    <Card title={'\u7edf\u4e00\u7528\u6237\u4e0e\u8bbe\u5907\u5ba1\u6838'}>
      <Alert
        type="info"
        showIcon
        message={'\u8d26\u53f7\u89d2\u8272\u7531\u670d\u52a1\u7aef\u7edf\u4e00\u7ba1\u7406'}
        description={'\u672c\u9875\u4fdd\u7559\u8bbe\u5907\u914d\u5bf9\u5ba1\u6838\uff1b\u7528\u6237\u89d2\u8272\u7ba1\u7406\u754c\u9762\u5c06\u5728\u7edf\u4e00\u89d2\u8272 API \u57fa\u7840\u4e0a\u5b8c\u5584\u3002'}
        style={{ marginBottom: 16 }}
      />
      <PairingReviewPanel />
    </Card>
  </div>
);

export default PermissionManager;
