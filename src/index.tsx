import React from 'react';
import ReactDOM from 'react-dom/client';
import DesktopIdentityGate from './components/DesktopIdentityGate';
import { App as AntdApp, ConfigProvider } from 'antd';
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

async function renderRoot() {
  if (process.env.NODE_ENV === 'development') {
    const fixture = await import('./services/desktopLoginChromeFixture.mjs');
    if (fixture.shouldInstallDesktopLoginChromeFixture({
      nodeEnv: process.env.NODE_ENV,
      location: window.location,
    })) fixture.installDesktopLoginChromeFixture(window);
  }

  const rootElement = document.getElementById('root');
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <ConfigProvider locale={zhCN} theme={appTheme} select={{ showSearch: true }}>
        <AntdApp>
          <DesktopIdentityGate />
        </AntdApp>
      </ConfigProvider>
    );
  }
}

void renderRoot();
