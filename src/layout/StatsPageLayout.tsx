import React, { useState } from 'react';
import { Card } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

interface StatsPageLayoutProps {
  filters: React.ReactNode;
  metrics: React.ReactNode;
  summary: React.ReactNode;
  details: React.ReactNode;
}

const StatsPageLayout: React.FC<StatsPageLayoutProps> = ({
  filters,
  metrics,
  summary,
  details,
}) => {
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [metricsCollapsed, setMetricsCollapsed] = useState(false);

  return (
    <div className="stats-page-layout">
      <div className="stats-page-layout__sticky">
        <Card 
          className="stats-page-layout__filters" 
          size="small"
          title={
            <div 
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              role="button"
              tabIndex={0}
              aria-expanded={!filtersCollapsed}
              onClick={() => setFiltersCollapsed(value => !value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setFiltersCollapsed(value => !value);
                }
              }}
            >
              {filtersCollapsed ? <RightOutlined /> : <DownOutlined />}
              <span>筛选条件</span>
            </div>
          }
        >
          {!filtersCollapsed && filters}
        </Card>

        <Card 
          className="stats-page-layout__metrics"
          size="small"
          title={
            <div 
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              role="button"
              tabIndex={0}
              aria-expanded={!metricsCollapsed}
              onClick={() => setMetricsCollapsed(value => !value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setMetricsCollapsed(value => !value);
                }
              }}
            >
              {metricsCollapsed ? <RightOutlined /> : <DownOutlined />}
              <span>关键指标</span>
            </div>
          }
        >
          {!metricsCollapsed && metrics}
        </Card>
      </div>

      <div className="stats-page-layout__summary">
        {summary}
      </div>

      <div className="stats-page-layout__details">
        {details}
      </div>
    </div>
  );
};

export default StatsPageLayout;
