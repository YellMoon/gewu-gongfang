import React, { useEffect, useMemo, useState } from 'react';
import { Button, Layout, Menu, Space, Tag, Tooltip } from 'antd';
import {
  CloudSyncOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageHeaderBar from './PageHeaderBar';
import { findNavItem, findOpenGroup, navGroups, PageKey } from '../navigation/appNavigation';

const { Content, Sider } = Layout;

interface AppShellProps {
  currentPage: PageKey;
  onNavigate: (page: PageKey) => void;
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
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([findOpenGroup(currentPage)]);
  const currentNavItem = findNavItem(currentPage);

  useEffect(() => {
    if (!collapsed) {
      setOpenKeys([findOpenGroup(currentPage)]);
    }
  }, [collapsed, currentPage]);

  const menuItems = useMemo(
    () => navGroups.map((group) => ({
      key: group.key,
      icon: group.icon,
      label: group.label,
      children: group.items.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label,
      })),
    })),
    [],
  );

  return (
    <Layout className="app-shell">
      <Sider
        className="app-shell__sider"
        width={236}
        collapsedWidth={72}
        collapsible
        collapsed={collapsed}
        trigger={null}
      >
        <div className="app-shell__brand">
          <div className="app-shell__brand-mark">格</div>
          {!collapsed && (
            <div className="app-shell__brand-copy">
              <div className="app-shell__brand-title">格物工坊</div>
              <div className="app-shell__brand-subtitle">运营工作台</div>
            </div>
          )}
        </div>
        <Menu
          className="app-shell__menu"
          mode="inline"
          theme="dark"
          selectedKeys={[selectedKeyForPage(currentPage)]}
          openKeys={collapsed ? [] : openKeys}
          items={menuItems}
          onOpenChange={(keys) => setOpenKeys(keys.slice(-1))}
          onClick={({ key }) => onNavigate(key as PageKey)}
        />
      </Sider>
      <Layout className="app-shell__main">
        <div className="app-shell__topbar">
          <Tooltip title={collapsed ? '展开导航' : '收起导航'}>
            <Button
              className="app-shell__collapse-button"
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
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
