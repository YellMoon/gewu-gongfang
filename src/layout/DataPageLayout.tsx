import React from 'react';
import { Card, Drawer } from 'antd';

interface DataPageLayoutProps {
  toolbar: React.ReactNode;
  table: React.ReactNode;
  drawerOpen: boolean;
  drawerTitle: React.ReactNode;
  drawerContent: React.ReactNode;
  onDrawerClose: () => void;
  drawerWidth?: number | string;
  drawerExtra?: React.ReactNode;
  drawerFooter?: React.ReactNode;
  destroyOnClose?: boolean;
}

const DataPageLayout: React.FC<DataPageLayoutProps> = ({
  toolbar,
  table,
  drawerOpen,
  drawerTitle,
  drawerContent,
  onDrawerClose,
  drawerWidth = 560,
  drawerExtra,
  drawerFooter,
  destroyOnClose,
}) => {
  const responsiveDrawerWidth =
    typeof drawerWidth === 'number'
      ? `min(${drawerWidth}px, calc(100vw - 16px))`
      : drawerWidth;

  return (
    <div className="data-page-layout">
      <Card className="data-page-layout__toolbar" size="small">
        {toolbar}
      </Card>
      <Card className="data-page-layout__table" size="small">
        {table}
      </Card>
      <Drawer
        title={drawerTitle}
        open={drawerOpen}
        onClose={onDrawerClose}
        width={responsiveDrawerWidth}
        extra={drawerExtra}
        footer={drawerFooter}
        destroyOnClose={destroyOnClose}
      >
        {drawerContent}
      </Drawer>
    </div>
  );
};

export default DataPageLayout;
