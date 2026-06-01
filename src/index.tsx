import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { colorPrimary: '#1890ff' } }}
      select={{ showSearch: true }}
    >
      <App />
    </ConfigProvider>
  );
}
