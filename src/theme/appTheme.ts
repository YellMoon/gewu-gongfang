import type { ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677b8',
    colorSuccess: '#1f8a5b',
    colorWarning: '#d97706',
    colorError: '#c2413a',
    colorTextHeading: '#172033',
    colorText: '#172033',
    colorTextSecondary: '#586174',
    colorBgLayout: '#f5f7fb',
    colorBorder: '#d8dee9',
    borderRadius: 6,
    controlHeight: 32,
    controlHeightSM: 26,
    controlHeightLG: 38,
    fontSize: 14,
    lineHeight: 1.5,
    wireframe: false,
  },
  components: {
    Button: {
      borderRadius: 6,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 38,
      paddingInline: 14,
      paddingInlineSM: 10,
    },
    Card: {
      borderRadiusLG: 6,
      headerHeight: 40,
      paddingLG: 16,
    },
    Form: {
      itemMarginBottom: 14,
      labelHeight: 28,
    },
    Input: {
      borderRadius: 6,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 38,
      paddingInline: 10,
    },
    Layout: {
      bodyBg: '#f5f7fb',
      headerBg: '#ffffff',
      siderBg: '#ffffff',
    },
    Menu: {
      itemBorderRadius: 6,
      itemHeight: 36,
    },
    Modal: {
      borderRadiusLG: 6,
      paddingContentHorizontalLG: 20,
      paddingContentVerticalLG: 16,
    },
    Select: {
      borderRadius: 6,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 38,
      optionHeight: 30,
    },
    Table: {
      borderColor: '#d8dee9',
      cellFontSize: 13,
      cellPaddingBlock: 6,
      cellPaddingBlockSM: 4,
      cellPaddingInline: 8,
      cellPaddingInlineSM: 8,
      headerBg: '#f8fafc',
      headerColor: '#172033',
    },
    Tabs: {
      cardHeight: 34,
      horizontalMargin: '0 0 12px 0',
    },
  },
};
