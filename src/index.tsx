import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import localeData from 'dayjs/plugin/localeData';
import updateLocale from 'dayjs/plugin/updateLocale';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { appTheme } from './theme/appTheme';
import './styles/design-tokens.css';
import './index.css';

dayjs.extend(localeData);
dayjs.extend(updateLocale);
dayjs.extend(weekOfYear);
dayjs.locale('zh-cn');
dayjs.updateLocale('zh-cn', { weekStart: 1 });

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ConfigProvider locale={zhCN} theme={appTheme} select={{ showSearch: true }}>
      <App />
    </ConfigProvider>
  );
}
