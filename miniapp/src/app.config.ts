export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/login/index',
    'pages/schedule/index',
    'pages/schedule/detail/index',
    'pages/schedule/edit/index',
    'pages/students/index',
    'pages/student-detail/index',
    'pages/courses/index',
    'pages/teachers/index',
    'pages/payments/index',
    'pages/stats/index',
    'pages/question-bank/index',
    'pages/assets/index',
    'pages/settings/index',
    'pages/admin/users/index',
    'pages/admin/invitations/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1890ff',
    navigationBarTitleText: '教育综合服务平台',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f5f5',
  },
  tabBar: {
    custom: true,
    color: '#999',
    selectedColor: '#1890ff',
    backgroundColor: '#fff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
      },
      {
        pagePath: 'pages/schedule/index',
        text: '课程表',
      },
      {
        pagePath: 'pages/students/index',
        text: '学员',
      },
      {
        pagePath: 'pages/assets/index',
        text: '财务',
      },
      {
        pagePath: 'pages/settings/index',
        text: '设置',
      },
    ],
  },
});
