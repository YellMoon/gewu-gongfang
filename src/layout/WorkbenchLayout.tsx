import React from 'react';
import { Card } from 'antd';

interface WorkbenchLayoutProps {
  sidebar: React.ReactNode;
  canvas: React.ReactNode;
}

const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  sidebar,
  canvas,
}) => {
  return (
    <div className="workbench-layout">
      <div className="workbench-layout__body">
        <Card size="small" className="workbench-layout__sidebar">
          <div className="workbench-layout__sidebar-content">
            {sidebar}
          </div>
        </Card>

        <div className="workbench-layout__canvas">
          {canvas}
        </div>
      </div>
    </div>
  );
};

export default WorkbenchLayout;
