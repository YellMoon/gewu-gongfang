import React from 'react';
import { Button, Card } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';

interface WorkbenchLayoutProps {
  toolbar: React.ReactNode;
  sidebar: React.ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  canvas: React.ReactNode;
}

const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  toolbar,
  sidebar,
  sidebarCollapsed,
  onToggleSidebar,
  canvas,
}) => {
  return (
    <div className={`workbench-layout${sidebarCollapsed ? ' workbench-layout--sidebar-collapsed' : ''}`}>
      <Card size="small" className="workbench-layout__toolbar">
        {toolbar}
      </Card>

      <div className="workbench-layout__body">
        <Card size="small" className="workbench-layout__sidebar">
          <Button
            type="text"
            className="workbench-layout__sidebar-toggle"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? '展开课程池' : '收起课程池'}
            aria-label={sidebarCollapsed ? '展开课程池' : '收起课程池'}
          />
          {!sidebarCollapsed && (
            <div className="workbench-layout__sidebar-content">
              {sidebar}
            </div>
          )}
        </Card>

        <div className="workbench-layout__canvas">
          {canvas}
        </div>
      </div>
    </div>
  );
};

export default WorkbenchLayout;
