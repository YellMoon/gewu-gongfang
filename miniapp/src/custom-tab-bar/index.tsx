import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import './index.scss';

type TabItem = {
  pagePath: string;
  label: string;
  iconText: string;
};

const ADMIN_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconText: '⌂' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconText: '□' },
  { pagePath: 'pages/students/index', label: '学员', iconText: '○' },
  { pagePath: 'pages/assets/index', label: '财务', iconText: '¥' },
  { pagePath: 'pages/settings/index', label: '我的', iconText: '⋯' },
];

const STUDENT_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconText: '⌂' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconText: '□' },
  { pagePath: 'pages/settings/index', label: '我的', iconText: '⋯' },
];

function getCurrentRoute() {
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

  const handleSwitch = (item: TabItem) => {
    if (item.pagePath === currentRoute) return;
    Taro.switchTab({ url: `/${item.pagePath}` });
  };

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
