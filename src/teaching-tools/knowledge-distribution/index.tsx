// 知识点分布统计 — 内置教学工具插件
import React from 'react';
import { Card, Row, Col, Statistic, Tag, Space, Empty, Table } from 'antd';
import { AimOutlined } from '@ant-design/icons';
import type { PluginComponentProps } from '../plugin-api';

const KnowledgeDistribution: React.FC<PluginComponentProps> = ({ api }) => {
  const [questions, setQuestions] = React.useState<any[]>([]);

  React.useEffect(() => {
    const db = (window as any).dbService;
    if (!db) return;
    setQuestions(db.getAllQuestions?.() || []);
  }, []);

  const questionsBySubject: Record<string, any[]> = {};
  questions.forEach((q: any) => {
    if (!questionsBySubject[q.subject]) questionsBySubject[q.subject] = [];
    questionsBySubject[q.subject].push(q);
  });

  const subjectStats = Object.entries(questionsBySubject).map(([subject, qs]: [string, any[]]) => ({
    subject,
    total: qs.length,
    byType: [...new Set(qs.map((q: any) => q.type))].map((t: string) => ({
      type: t,
      count: qs.filter((q: any) => q.type === t).length,
    })),
    byDifficulty: [1, 2, 3, 4, 5].map((d: number) => ({
      level: d,
      count: qs.filter((q: any) => q.difficulty === d).length,
    })),
    coverage: [...new Set(qs.filter((q: any) => q.knowledge_point).map((q: any) => q.knowledge_point))].length,
  }));

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="题目总数" value={questions.length} suffix="题" valueStyle={{ fontSize: 28 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="覆盖科目" value={Object.keys(questionsBySubject).length} suffix="科" valueStyle={{ fontSize: 28, color: '#1890ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="知识点数" value={[...new Set(questions.filter((q: any) => q.knowledge_point).map((q: any) => q.knowledge_point!))].length} suffix="个" valueStyle={{ fontSize: 28 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="题型种类" value={[...new Set(questions.map((q: any) => q.type))].length} suffix="种" valueStyle={{ fontSize: 28, color: '#722ed1' }} />
          </Card>
        </Col>
      </Row>

      {subjectStats.map(ss => (
        <Card key={ss.subject} title={`${ss.subject} - 题库概览`} size="small" style={{ marginBottom: 12 }}>
          <Row gutter={16}>
            <Col span={12}>
              <p><strong>题型分布：</strong></p>
              <Space wrap>
                {ss.byType.map((t: any) => (
                  <Tag key={t.type}>{t.type}: {t.count}题</Tag>
                ))}
              </Space>
            </Col>
            <Col span={12}>
              <p><strong>难度分布：</strong></p>
              <Space wrap>
                {ss.byDifficulty.filter((d: any) => d.count > 0).map((d: any) => (
                  <Tag key={d.level} color={d.level <= 2 ? 'green' : d.level <= 3 ? 'orange' : 'red'}>
                    {'★'.repeat(d.level)}: {d.count}题
                  </Tag>
                ))}
              </Space>
            </Col>
          </Row>
          <p style={{ marginTop: 8, color: '#666' }}>覆盖知识点: {ss.coverage} 个</p>
        </Card>
      ))}

      {questions.length === 0 && (
        <Card><Empty description="暂无题库数据，请先添加题目" /></Card>
      )}
    </div>
  );
};

export default KnowledgeDistribution;
