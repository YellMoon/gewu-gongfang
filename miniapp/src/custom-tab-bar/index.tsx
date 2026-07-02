import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import './index.scss';

declare const getCurrentPages: (() => Array<{ route?: string }>) | undefined;

type TabItem = {
  pagePath: string;
  label: string;
  iconText: string;
};

const ADMIN_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconText: '首' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconText: '课' },
  { pagePath: 'pages/students/index', label: '学员', iconText: '生' },
  { pagePath: 'pages/assets/index', label: '财务', iconText: '账' },
  { pagePath: 'pages/settings/index', label: '我的', iconText: '我' },
];

const STUDENT_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconText: '首' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconText: '课' },
  { pagePath: 'pages/settings/index', label: '我的', iconText: '我' },
];

function getCurrentRoute() {
  if (typeof window !== 'undefined') {
    const hashRoute = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    if (hashRoute) return hashRoute;
  }
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages[pages.length - 1];
  return current?.route || 'pages/index/index';
}

function getUserType() {
  try {
    return Taro.getStorageSync('user_info')?.user_type || 'student';
  } catch {
    return 'student';
  }
}

export default function RoleTabBar() {
  const [currentRoute, setCurrentRoute] = useState(getCurrentRoute());
  const [userType, setUserType] = useState(getUserType());

  useDidShow(() => {
    setCurrentRoute(getCurrentRoute());
    setUserType(getUserType());
  });

  const tabs = useMemo(() => (
    userType === 'student' ? STUDENT_TABS : ADMIN_TABS
  ), [userType]);

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
