import React from 'react';
import {
  AppstoreOutlined,
  BankOutlined,
  BarChartOutlined,
  BookOutlined,
  CalendarOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FileWordOutlined,
  HomeOutlined,
  LockOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';

export type PageKey =
  | 'today'
  | 'course-calendar' | 'schedule-list' | 'course-info'
  | 'school' | 'address' | 'institution'
  | 'question-bank-tools' | 'question-bank-import' | 'question-bank-preview' | 'question-bank-edit' | 'question-bank-paper' | 'question-bank-audit'
  | 'payment' | 'revenue-statistics' | 'personal-assets'
  | 'admin' | 'teacher' | 'student' | 'invitee' | 'permission'
  | 'menu-manage' | 'system-params' | 'operate-log'
  | 'cloud-sync';

export interface NavItem {
  key: PageKey;
  label: string;
  description?: string;
  icon: React.ReactNode;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}

export const questionBankPages: PageKey[] = [
  'question-bank-tools',
  'question-bank-import',
  'question-bank-preview',
  'question-bank-edit',
  'question-bank-paper',
  'question-bank-audit',
];

export const navGroups: NavGroup[] = [
  {
    key: 'today',
    label: '今日',
    icon: <HomeOutlined />,
    items: [
      { key: 'today', label: '今日工作台', description: '快速进入常用运营任务', icon: <AppstoreOutlined /> },
    ],
  },
  {
    key: 'academic',
    label: '教务',
    icon: <CalendarOutlined />,
    items: [
      { key: 'course-calendar', label: '课程表', description: '查看和维护排课日历', icon: <CalendarOutlined /> },
      { key: 'schedule-list', label: '排课列表', description: '按列表管理排课记录', icon: <FileTextOutlined /> },
      { key: 'course-info', label: '课程信息', description: '维护课程基础资料', icon: <BookOutlined /> },
    ],
  },
  {
    key: 'question-bank',
    label: '题库',
    icon: <DatabaseOutlined />,
    items: [
      { key: 'question-bank-tools', label: '题库工具', description: '导入、编辑与审核入口', icon: <ToolOutlined /> },
      { key: 'question-bank-preview', label: '试题预览', description: '检索和预览题库内容', icon: <FileTextOutlined /> },
      { key: 'question-bank-paper', label: '组卷', description: '从题篮生成试卷', icon: <FileWordOutlined /> },
    ],
  },
  {
    key: 'finance',
    label: '财务',
    icon: <DollarOutlined />,
    items: [
      { key: 'payment', label: '缴费', description: '登记和查询缴费记录', icon: <DollarOutlined /> },
      { key: 'revenue-statistics', label: '费用统计', description: '查看收入统计数据', icon: <BarChartOutlined /> },
      { key: 'personal-assets', label: '个人资产统计', description: '查看个人资产报表', icon: <DatabaseOutlined /> },
    ],
  },
  {
    key: 'resources',
    label: '资源',
    icon: <TeamOutlined />,
    items: [
      { key: 'school', label: '学校', description: '维护学校资源', icon: <BankOutlined /> },
      { key: 'address', label: '上课地址', description: '维护教室与上课地点', icon: <HomeOutlined /> },
      { key: 'institution', label: '机构', description: '维护合作机构资料', icon: <TeamOutlined /> },
      { key: 'teacher', label: '老师', description: '管理老师档案', icon: <TeamOutlined /> },
      { key: 'student', label: '学生', description: '管理学生档案', icon: <UserOutlined /> },
      { key: 'invitee', label: '被邀请者', description: '查看被邀请者授权信息', icon: <UserOutlined /> },
    ],
  },
  {
    key: 'system-data',
    label: '系统与数据',
    icon: <SettingOutlined />,
    items: [
      { key: 'admin', label: '管理员', description: '管理员登录和账号管理', icon: <UserOutlined /> },
      { key: 'permission', label: '权限管理', description: '配置模块访问权限', icon: <LockOutlined /> },
      { key: 'menu-manage', label: '菜单结构管理', description: '维护菜单配置', icon: <MenuOutlined /> },
      { key: 'system-params', label: '系统参数', description: '调整系统基础参数', icon: <SettingOutlined /> },
      { key: 'operate-log', label: '操作日志', description: '查看系统操作记录', icon: <FileProtectOutlined /> },
      { key: 'cloud-sync', label: '云同步', description: '管理本地与云端数据同步', icon: <CloudSyncOutlined /> },
    ],
  },
];

const legacyQuestionBankItems: Record<PageKey, NavItem> = {
  'question-bank-import': { key: 'question-bank-import', label: '试题导入', description: '导入题库文档和试题', icon: <UploadOutlined /> },
  'question-bank-edit': { key: 'question-bank-edit', label: '试题编辑', description: '编辑已导入的试题', icon: <BookOutlined /> },
  'question-bank-audit': { key: 'question-bank-audit', label: '审核中心', description: '审核题库变更与内容', icon: <SafetyCertificateOutlined /> },
  today: { key: 'today', label: '今日工作台', icon: <AppstoreOutlined /> },
  'course-calendar': { key: 'course-calendar', label: '课程表', icon: <CalendarOutlined /> },
  'schedule-list': { key: 'schedule-list', label: '排课列表', icon: <FileTextOutlined /> },
  'course-info': { key: 'course-info', label: '课程信息', icon: <BookOutlined /> },
  school: { key: 'school', label: '学校', icon: <BankOutlined /> },
  address: { key: 'address', label: '上课地址', icon: <HomeOutlined /> },
  institution: { key: 'institution', label: '机构', icon: <TeamOutlined /> },
  'question-bank-tools': { key: 'question-bank-tools', label: '题库工具', icon: <ToolOutlined /> },
  'question-bank-preview': { key: 'question-bank-preview', label: '试题预览', icon: <FileTextOutlined /> },
  'question-bank-paper': { key: 'question-bank-paper', label: '组卷', icon: <FileWordOutlined /> },
  payment: { key: 'payment', label: '缴费', icon: <DollarOutlined /> },
  'revenue-statistics': { key: 'revenue-statistics', label: '费用统计', icon: <BarChartOutlined /> },
  'personal-assets': { key: 'personal-assets', label: '个人资产统计', icon: <DatabaseOutlined /> },
  admin: { key: 'admin', label: '管理员', icon: <UserOutlined /> },
  teacher: { key: 'teacher', label: '老师', icon: <TeamOutlined /> },
  student: { key: 'student', label: '学生', icon: <UserOutlined /> },
  invitee: { key: 'invitee', label: '被邀请者', icon: <UserOutlined /> },
  permission: { key: 'permission', label: '权限管理', icon: <LockOutlined /> },
  'menu-manage': { key: 'menu-manage', label: '菜单结构管理', icon: <MenuOutlined /> },
  'system-params': { key: 'system-params', label: '系统参数', icon: <SettingOutlined /> },
  'operate-log': { key: 'operate-log', label: '操作日志', icon: <FileProtectOutlined /> },
  'cloud-sync': { key: 'cloud-sync', label: '云同步', icon: <CloudSyncOutlined /> },
};

export const findNavItem = (pageKey: PageKey): NavItem => {
  for (const group of navGroups) {
    const item = group.items.find((navItem) => navItem.key === pageKey);
    if (item) {
      return item;
    }
  }
  return legacyQuestionBankItems[pageKey];
};

export const findOpenGroup = (pageKey: PageKey): string => {
  if (pageKey.startsWith('question-bank-')) {
    return 'question-bank';
  }
  const group = navGroups.find((navGroup) => navGroup.items.some((item) => item.key === pageKey));
  return group?.key || 'today';
};
