import React from 'react';
import { Card } from 'antd';

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
  return (
    <div className="stats-page-layout">
      <Card className="stats-page-layout__filters" size="small">
        {filters}
      </Card>

      <div className="stats-page-layout__metrics">
        {metrics}
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
