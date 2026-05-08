// 教学工具 — 完整版本（用Tab切换插件，无下拉框）
import React, { useState } from 'react';
import { Card, Tabs } from 'antd';
import { SoundOutlined, AimOutlined, BarChartOutlined } from '@ant-design/icons';
import WaveDemo from '../teaching-tools/wave-demo/index';
import KnowledgeDistribution from '../teaching-tools/knowledge-distribution/index';
import PerformanceAnalysis from '../teaching-tools/performance-analysis/index';

const TeachingTools: React.FC = () => {
  const [pluginParams, setPluginParams] = useState<Record<string, any>>({});

  const commonProps = {
    api: null as any,
    params: pluginParams,
    onParamsChange: setPluginParams,
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SoundOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          <h2 style={{ margin: 0 }}>教学工具</h2>
        </div>
      </Card>

      <Tabs
        defaultActiveKey="wave-demo"
        type="card"
        size="middle"
        style={{ padding: '0 16px' }}
        items={[
          {
            key: 'wave-demo',
            label: <span><SoundOutlined /> 机械波演示</span>,
            children: <WaveDemo {...commonProps} />,
          },
          {
            key: 'knowledge-distribution',
            label: <span><AimOutlined /> 知识分布</span>,
            children: <KnowledgeDistribution {...commonProps} />,
          },
          {
            key: 'performance-analysis',
            label: <span><BarChartOutlined /> 成绩分析</span>,
            children: <PerformanceAnalysis {...commonProps} />,
          },
        ]}
      />
    </div>
  );
};

export default TeachingTools;
