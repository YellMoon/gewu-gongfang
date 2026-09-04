import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { fetchPermissions, getEffectiveMiniappAccess } from '../utils/permission';
import { resolveTabBarState } from './roleTabBarRuntime';
import './index.scss';

declare const getCurrentPages: (() => Array<{ route?: string }>) | undefined;

type TabItem = {
  pagePath: string;
  label: string;
  iconText: string;
};

const PRIMARY_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconText: '首' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconText: '课' },
  { pagePath: 'pages/question-bank/index', label: '题库', iconText: '题' },
  { pagePath: 'pages/settings/index', label: '我的', iconText: '我' },
];

const STAFF_TABS: TabItem[] = PRIMARY_TABS;
const STUDENT_TABS: TabItem[] = PRIMARY_TABS;
const VISITOR_TABS: TabItem[] = PRIMARY_TABS;

function getCurrentRoute() {
  if (typeof window !== 'undefined') {
    const hashRoute = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    if (hashRoute) return hashRoute;
  }
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages[pages.length - 1];
  return current?.route || 'pages/index/index';
}

export default function RoleTabBar() {
  const [currentRoute, setCurrentRoute] = useState(getCurrentRoute());
  const initialState = resolveTabBarState(getEffectiveMiniappAccess());
  const [userType, setUserType] = useState(initialState.userType);
  const [navigationMode, setNavigationMode] = useState(initialState.navigationMode);

  const applyAccess = (access: { role: any; modules: any[] }) => {
    const next = resolveTabBarState(access);
    setUserType(next.userType);
    setNavigationMode(next.navigationMode);
  };

  useDidShow(() => {
    setCurrentRoute(getCurrentRoute());
    const localAccess = getEffectiveMiniappAccess();
    applyAccess(localAccess);
    if (localAccess.role === 'visitor' || localAccess.modules.length === 0) {
      return;
    }
    void fetchPermissions().then(() => {
      applyAccess(getEffectiveMiniappAccess());
    }).catch(() => {
      applyAccess({ role: 'visitor', modules: [] });
    });
  });

  const tabs = useMemo(() => (
    navigationMode === 'visitor'
      ? VISITOR_TABS
      : (['student', 'family_member'].includes(userType) ? STUDENT_TABS : STAFF_TABS)
  ), [navigationMode, userType]);

  const isTabPage = tabs.some((item) => item.pagePath === currentRoute);

  const handleSwitch = (item: TabItem) => {
    if (item.pagePath === currentRoute) return;
    Taro.switchTab({ url: `/${item.pagePath}` });
  };

  if (!isTabPage) return null;

  return (
    <View className="role-tabbar">
      {tabs.map((item) => {
        const active = item.pagePath === currentRoute;
        return (
          <View
            key={item.pagePath}
            className={`role-tabbar-item ${active ? 'active' : ''}`}
            onClick={() => handleSwitch(item)}
          >
            <View className="role-tabbar-icon">{item.iconText}</View>
            <Text className="role-tabbar-label">{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
