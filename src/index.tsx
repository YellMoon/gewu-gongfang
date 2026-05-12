import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './index.css';

document.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('.ant-select-item-option') && !target.closest('.ant-time-picker-panel') && !target.closest('.ant-picker-time-panel')) {
    setTimeout(() => {
      const openSelects = document.querySelectorAll('.ant-select-open');
      openSelects.forEach((el) => {
        if (el.querySelector) {
          const input = el.querySelector('input.ant-select-selection-search-input') as HTMLElement;
          if (input) input.blur();
        }
      });
    }, 50);
  }
});

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1890ff' } }}>
      <App />
    </ConfigProvider>
  );
}
