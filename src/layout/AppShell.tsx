import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Layout, Menu, Tooltip } from 'antd';
import {
  DownOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  FileSearchOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import PageHeaderBar from './PageHeaderBar';
import { findNavItem, findOpenGroup, navGroups, PageKey, todayNavItem } from '../navigation/appNavigation';
import type { NavigationInput } from '../navigation/navigationContext';
import SyncQuickPanel from '../components/sync/SyncQuickPanel';
import { DesktopAccountContext } from '../components/DesktopAccountContext';

const { Content, Sider } = Layout;

interface AppShellProps {
  currentPage: PageKey;
  onNavigate: (page: NavigationInput) => void;
  onRefresh: () => void;
  children: React.ReactNode;
  questionBankSubject?: string;
  onQuestionBankSubjectChange?: (subject: string) => void;
}

const selectedKeyForPage = (page: PageKey): PageKey => {
  if (page === 'question-bank-import' || page === 'question-bank-audit') {
    return 'question-bank-tools';
  }
  return page;
};

const AppShell: React.FC<AppShellProps> = ({ currentPage, onNavigate, onRefresh, children, questionBankSubject, onQuestionBankSubjectChange }) => {
  const account = useContext(DesktopAccountContext);
  const [navOpen, setNavOpen] = useState(false);
  const [navPinned, setNavPinned] = useState(false);
  const initialOpenGroup = findOpenGroup(currentPage);
  const [openKeys, setOpenKeys] = useState<string[]>(initialOpenGroup ? [initialOpenGroup] : []);
  const closeTimerRef = useRef<number | null>(null);
  const currentNavItem = findNavItem(currentPage);
  const navVisible = navOpen || navPinned;

  useEffect(() => {
    if (!navVisible) {
      setOpenKeys([]);
      return;
    }
    const group = findOpenGroup(currentPage);
    if (group) {
      setOpenKeys(prev => prev.includes(group) ? prev : [...prev, group]);
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
        children: group.items.filter(item => item.key !== 'account-review' || account.activeRole === 'super_admin').map((item) => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
        })),
      })),
    ],
    [account.activeRole],
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
          onOpenChange={(keys) => setOpenKeys([...keys])}
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
            title={(currentPage === 'question-bank-preview' || currentPage === 'question-bank-edit') && questionBankSubject && onQuestionBankSubjectChange
              ? <Dropdown trigger={['click']} menu={{
                selectedKeys: [questionBankSubject],
                items: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'].map(subject => ({ key: subject, label: subject + '题库' })),
                onClick: ({ key }) => onQuestionBankSubjectChange(key),
              }}><button className="qb-subject-title-button" type="button" aria-label="选择科目题库">{questionBankSubject}{currentPage === 'question-bank-edit' ? '编辑与打标' : '题库'}<DownOutlined /></button></Dropdown>
              : currentNavItem.label}
            titleActions={currentPage === 'question-bank-tools' ? <>
              <Button icon={<FileSearchOutlined />} onClick={() => onNavigate('question-bank-preview')}>题库</Button>
              <Button type="primary" icon={<FileWordOutlined />} onClick={() => onNavigate('question-bank-paper')}>去组卷</Button>
            </> : undefined}
            description={currentPage === 'today' ? new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : undefined}
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
            actions={<><SyncQuickPanel onNavigate={onNavigate} />{account.controls}</>}
          />
        </div>
        <Content className={`app-shell__content app-shell__content--${currentPage}`}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppShell;
