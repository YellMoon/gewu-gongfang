import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Layout, Menu, Space, Tag, Tooltip } from 'antd';
import {
  CloudSyncOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageHeaderBar from './PageHeaderBar';
import { findNavItem, findOpenGroup, navGroups, PageKey, todayNavItem } from '../navigation/appNavigation';
import type { NavigationInput } from '../navigation/navigationContext';

const { Content, Sider } = Layout;

interface AppShellProps {
  currentPage: PageKey;
  onNavigate: (page: NavigationInput) => void;
  onRefresh: () => void;
  children: React.ReactNode;
}

const selectedKeyForPage = (page: PageKey): PageKey => {
  if (page === 'question-bank-import' || page === 'question-bank-edit' || page === 'question-bank-audit') {
    return 'question-bank-tools';
  }
  return page;
};

const AppShell: React.FC<AppShellProps> = ({ currentPage, onNavigate, onRefresh, children }) => {
  const [navOpen, setNavOpen] = useState(false);
  const [navPinned, setNavPinned] = useState(false);
  const initialOpenGroup = findOpenGroup(currentPage);
  const [openKeys, setOpenKeys] = useState<string[]>(initialOpenGroup ? [initialOpenGroup] : []);
  const closeTimerRef = useRef<number | null>(null);
  const currentNavItem = findNavItem(currentPage);
  const navVisible = navOpen || navPinned;

  useEffect(() => {
    if (navVisible) {
      const group = findOpenGroup(currentPage);
      setOpenKeys(group ? [group] : []);
    }
  }, [navVisible, currentPage]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openNavTemporarily = () => {
    clearCloseTimer();
    setNavOpen(true);
  };

  const scheduleCloseNav = () => {
    if (navPinned) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setNavOpen(false), 280);
  };

  const togglePinnedNav = () => {
    clearCloseTimer();
    if (navPinned) {
      setNavPinned(false);
      setNavOpen(false);
      return;
    }
    setNavOpen(true);
    setNavPinned(true);
  };

  const handleNavigate = (page: PageKey) => {
    onNavigate(page);
    if (!navPinned) {
      setNavOpen(false);
    }
  };

  const menuItems = useMemo(
    () => [
      {
        key: todayNavItem.key,
        icon: todayNavItem.icon,
        label: todayNavItem.label,
      },
      ...navGroups.map((group) => ({
        key: group.key,
        icon: group.icon,
        label: group.label,
        children: group.items.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
        })),
      })),
    ],
    [],
  );

  return (
    <Layout className={navPinned ? 'app-shell app-shell--nav-pinned' : 'app-shell'}>
      <div
        className="app-shell__edge-trigger"
        onMouseEnter={openNavTemporarily}
        aria-hidden="true"
      />
      <Sider
        className={[
          'app-shell__sider',
          navVisible ? 'app-shell__sider--open' : '',
          navPinned ? 'app-shell__sider--pinned' : '',
        ].filter(Boolean).join(' ')}
        width={236}
        collapsible
        trigger={null}
        onMouseEnter={openNavTemporarily}
        onMouseLeave={scheduleCloseNav}
      >
        <div className="app-shell__brand">
          <div className="app-shell__brand-mark">格</div>
          <div className="app-shell__brand-copy">
            <div className="app-shell__brand-title">格物工坊</div>
            <div className="app-shell__brand-subtitle">运营工作台</div>
          </div>
          {navPinned && (
            <Tooltip title="释放隐藏导航">
              <Button
                className="app-shell__sider-unpin"
                type="text"
                size="small"
                icon={<MenuFoldOutlined />}
                onClick={togglePinnedNav}
              />
            </Tooltip>
          )}
        </div>
        <Menu
          className="app-shell__menu"
          mode="inline"
          theme="dark"
          selectedKeys={[selectedKeyForPage(currentPage)]}
          openKeys={openKeys}
          items={menuItems}
          onOpenChange={(keys) => setOpenKeys(keys.slice(-1))}
          onClick={({ key }) => handleNavigate(key as PageKey)}
        />
      </Sider>
      <Layout className="app-shell__main">
        <div className="app-shell__topbar">
          <Tooltip title={navPinned ? '释放隐藏导航' : '锁定展开导航'}>
            <Button
              className="app-shell__collapse-button"
              type="text"
              icon={<MenuUnfoldOutlined />}
              onClick={togglePinnedNav}
            />
          </Tooltip>
          <PageHeaderBar
            title={currentNavItem.label}
            description={currentNavItem.description}
            secondaryActions={(
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={onRefresh}
              >
                刷新
              </Button>
            )}
            status={(
              <Space size={6} wrap>
                <Tag color="blue">本地</Tag>
                <Tag icon={<CloudSyncOutlined />} color="processing">同步</Tag>
              </Space>
            )}
          />
        </div>
        <Content className="app-shell__content">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppShell;
