import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { appTheme } from './theme/appTheme';
import './styles/design-tokens.css';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ConfigProvider locale={zhCN} theme={appTheme} select={{ showSearch: true }}>
      <App />
    </ConfigProvider>
  );
}
