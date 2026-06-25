import { Image, View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import './index.scss';

type TabItem = {
  pagePath: string;
  label: string;
  iconPath: string;
  selectedIconPath: string;
};

const ADMIN_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconPath: '/assets/tab-home.png', selectedIconPath: '/assets/tab-home-active.png' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconPath: '/assets/tab-calendar.png', selectedIconPath: '/assets/tab-calendar-active.png' },
  { pagePath: 'pages/students/index', label: '学员', iconPath: '/assets/tab-students.png', selectedIconPath: '/assets/tab-students-active.png' },
  { pagePath: 'pages/assets/index', label: '财务', iconPath: '/assets/tab-settings.png', selectedIconPath: '/assets/tab-settings-active.png' },
  { pagePath: 'pages/settings/index', label: '我的', iconPath: '/assets/tab-settings.png', selectedIconPath: '/assets/tab-settings-active.png' },
];

const STUDENT_TABS: TabItem[] = [
  { pagePath: 'pages/index/index', label: '首页', iconPath: '/assets/tab-home.png', selectedIconPath: '/assets/tab-home-active.png' },
  { pagePath: 'pages/schedule/index', label: '课程表', iconPath: '/assets/tab-calendar.png', selectedIconPath: '/assets/tab-calendar-active.png' },
  { pagePath: 'pages/settings/index', label: '我的', iconPath: '/assets/tab-settings.png', selectedIconPath: '/assets/tab-settings-active.png' },
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
            <Image
              className="role-tabbar-icon"
              src={active ? item.selectedIconPath : item.iconPath}
              mode="aspectFit"
            />
            <Text className="role-tabbar-label">{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
