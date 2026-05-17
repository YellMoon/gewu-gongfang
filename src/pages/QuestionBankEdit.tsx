import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Checkbox, Col, Empty, Form, Input, Modal, Row, Select as AntSelect,
  Space, Table, Tag, Tooltip, Typography, Upload, message
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  EditOutlined, FileImageOutlined, FunctionOutlined, TagsOutlined
} from '@ant-design/icons';
import type { KnowledgeNode, Question } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType } from '../constants/questionTypes';

const { TextArea } = Input;
const { Text } = Typography;
const Select = AutoCloseSelect as typeof AntSelect;
const API_BASE = getApiBase('/api/question-bank');

const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试', '竞赛', '强基计划', '其他'];
const GRADES = ['高一', '高二', '高三', '复习'];
const SEMESTERS = ['上学期', '下学期'];

function normalizeQuestion(row: any): Question {
  let options = row.options || [];
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { options = []; }
  }
  return {
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    content: row.content ?? row.stem ?? '',
    options: Array.isArray(options) ? options : [],
    answer: row.answer ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    edit_status: row.edit_status || '未编辑',
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
  } as Question;
}

function buildTreeOptions(nodes: KnowledgeNode[], parentId?: string, depth = 0): { label: string; value: string }[] {
  return nodes
    .filter(n => n.parent_id === parentId || (!parentId && !n.parent_id))
    .sort((a, b) => a.order - b.order)
    .flatMap(n => [
      { label: `${'  '.repeat(depth)}${n.name}`, value: n.id },
      ...buildTreeOptions(nodes, n.id, depth + 1),
    ]);
}

const QuestionBankEdit: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);
  const [editing, setEditing] = useState<Question | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const knowledgeOptions = useMemo(() => buildTreeOptions(knowledgeNodes), [knowledgeNodes]);
  const modelOptions = useMemo(() => buildTreeOptions(modelNodes), [modelNodes]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const db = (window as any).dbService;
    const localQuestions = db?.getAllQuestions?.()?.map(normalizeQuestion) || [];
    try {
      const res = await fetch(`${API_BASE}/questions?limit=200`);
      const data = await res.json();
      const rows = data.success && Array.isArray(data.data) ? data.data.map(normalizeQuestion) : localQuestions;
      setQuestions(rows.filter((q: Question) => (q.edit_status || '未编辑') === '未编辑'));
    } catch (_err) {
      setQuestions(localQuestions.filter((q: Question) => (q.edit_status || '未编辑') === '未编辑'));
    }
    const kn = db?.getKnowledgeTree?.() || [];
    const models = db?.getModelTree?.() || [];
    setKnowledgeNodes(kn);
    setModelNodes(models);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openEditor = (question: Question) => {
    setEditing(question);
    setImageFiles([]);
    form.setFieldsValue({
      content: question.content,
      answer: question.answer,
      analysis: question.analysis,
      options: (question.options || []).join('\n'),
      type: normalizeQuestionType(question.type),
      difficulty: question.difficulty,
      source: question.source,
      year: question.year,
      grade: question.grade,
      semester: question.semester,
      exam_type: question.exam_type,
      region: (question as any).region,
      school: (question as any).school,
      subject: question.subject || '物理',
      knowledge_ids: question.knowledge_ids || [],
      model_ids: question.model_ids || [],
      formulas: (question.formulas || []).join('\n'),
      tags: (question.tags || []).join(','),
    });
  };

  const saveQuestion = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    const payload: any = {
      stem: values.content,
      subject: values.subject || '物理',
      content: values.content,
      answer: values.answer,
      explanation: values.analysis,
      analysis: values.analysis,
      options: values.options ? values.options.split('\n').map((s: string) => s.trim()).filter(Boolean) : [],
      type: normalizeQuestionType(values.type),
      difficulty: values.difficulty || 3,
      source: values.source || '',
      year: values.year || '',
      grade: values.grade || '',
      semester: values.semester || '',
      exam_type: values.exam_type || '其他',
      region: values.region || '',
      school: values.school || '',
      knowledge_point_ids: values.knowledge_ids || [],
      knowledge_ids: values.knowledge_ids || [],
      model_point_ids: values.model_ids || [],
      model_ids: values.model_ids || [],
      edit_status: '已编辑',
      status: editing.status || 'draft',
      has_image: imageFiles.length > 0 || !!editing.has_image,
      has_formula: !!editing.has_formula,
      created_by: editing.created_by || '',
      formulas: values.formulas ? values.formulas.split('\n').map((s: string) => s.trim()).filter(Boolean) : [],
      tags: values.tags ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      assets: imageFiles.map(file => ({
        asset_type: 'image',
        file_name: file.name,
        mime_type: file.type || 'image/*',
        oss_key: `local-question-images/${editing.id}/${file.name}`,
        oss_url: file.url || file.thumbUrl || '',
      })),
    };
    try {
      const res = await fetch(`${API_BASE}/questions/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '后端保存失败');
    } catch (_err) {
      const db = (window as any).dbService;
      db?.updateQuestion?.(editing.id, {
        ...payload,
        content: payload.stem,
        analysis: payload.explanation,
        model_point: (values.model_ids || []).length > 0 ? modelNodes.find(n => n.id === values.model_ids[0])?.name || '' : '',
      });
    }
    message.success('试题已保存');
    setEditing(null);
    form.resetFields();
    loadData();
  };

  const applyBatchTags = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择试题');
      return;
    }
    const values = await form.validateFields(['knowledge_ids', 'model_ids', 'year', 'grade', 'semester', 'exam_type', 'region', 'school']);
    const db = (window as any).dbService;
    for (const id of selectedRowKeys) {
      const q = questions.find(item => item.id === id);
      if (!q) continue;
      const payload = {
        knowledge_point_ids: values.knowledge_ids || q.knowledge_ids || [],
        model_point_ids: values.model_ids || q.model_ids || [],
        year: values.year ?? q.year ?? '',
        grade: values.grade ?? q.grade ?? '',
        semester: values.semester ?? q.semester ?? '',
        exam_type: values.exam_type ?? q.exam_type ?? '',
        region: values.region ?? (q as any).region ?? '',
        school: values.school ?? (q as any).school ?? '',
      };
      try {
        await fetch(`${API_BASE}/questions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (_err) {
        db?.updateQuestion?.(id, { ...payload, knowledge_ids: payload.knowledge_point_ids, model_ids: payload.model_point_ids });
      }
    }
    message.success(`已更新 ${selectedRowKeys.length} 道试题标注`);
    setSelectedRowKeys([]);
    loadData();
  };

  const columns = [
    { title: '题干', dataIndex: 'content', ellipsis: true, render: (text: string) => <Text>{text}</Text> },
    { title: '科目', dataIndex: 'subject', width: 70, render: (v: string) => v || '物理' },
    { title: '题型', dataIndex: 'type', width: 90 },
    { title: '年份', dataIndex: 'year', width: 80, render: (v: string) => v || '-' },
    { title: '年级', dataIndex: 'grade', width: 80, render: (v: string) => v || '-' },
    { title: '考试类型', dataIndex: 'exam_type', width: 100, render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
    {
      title: '操作', width: 80, render: (_: any, record: Question) => (
        <Tooltip title="编辑试题">
          <Button type="link" icon={<EditOutlined />} onClick={() => openEditor(record)} />
        </Tooltip>
      )
    },
  ];

  return (
    <Row gutter={16}>
      <Col span={17}>
        <Card
          title={<Space><EditOutlined />试题编辑</Space>}
          extra={<Button icon={<TagsOutlined />} disabled={selectedRowKeys.length === 0} onClick={applyBatchTags}>批量应用标注</Button>}
        >
          <Table
            loading={loading}
            rowSelection={{ selectedRowKeys, onChange: keys => setSelectedRowKeys(keys as string[]) }}
            columns={columns}
            dataSource={questions}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 12, showTotal: t => `共 ${t} 题` }}
          />
        </Card>
      </Col>
      <Col span={7}>
        <Card size="small" title="批量标注面板">
          <Form form={form} layout="vertical">
            <Form.Item name="knowledge_ids" label="知识点">
              <Select mode="multiple" allowClear options={knowledgeOptions} placeholder="可多选，无数量上限" />
            </Form.Item>
            <Form.Item name="model_ids" label="模型">
              <Select mode="multiple" allowClear options={modelOptions} placeholder="可多选，无数量上限" />
            </Form.Item>
            <Row gutter={8}>
              <Col span={12}><Form.Item name="year" label="年份"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="grade" label="年级"><Select allowClear options={GRADES.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
            </Row>
            <Row gutter={8}>
              <Col span={12}><Form.Item name="semester" label="学期"><Select allowClear options={SEMESTERS.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="exam_type" label="考试类型"><Select allowClear options={EXAM_TYPES.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
            </Row>
            <Form.Item name="region" label="地区"><Input /></Form.Item>
            <Form.Item name="school" label="学校"><Input /></Form.Item>
          </Form>
        </Card>
      </Col>

      <Modal
        title="编辑试题内容与标注"
        open={!!editing}
        width={920}
        onOk={saveQuestion}
        okText="保存"
        onCancel={() => { setEditing(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Space style={{ marginBottom: 8 }}>
            <Tag icon={<FunctionOutlined />}>公式可用 LaTeX 或 Word 转写文本</Tag>
            <Tag icon={<FileImageOutlined />}>图片可上传替换附件</Tag>
          </Space>
          <Form.Item name="content" label="题干" rules={[{ required: true }]}>
            <TextArea rows={6} placeholder="编辑题干文字、公式占位和图片说明" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="answer" label="答案" rules={[{ required: true }]}><TextArea rows={3} /></Form.Item></Col>
            <Col span={12}><Form.Item name="analysis" label="解析"><TextArea rows={3} /></Form.Item></Col>
          </Row>
          <Form.Item name="options" label="选项"><TextArea rows={3} placeholder="每行一个选项" /></Form.Item>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="type" label="题型"><Select options={QUESTION_TYPES.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
            <Col span={6}><Form.Item name="year" label="年份"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="grade" label="年级"><Select allowClear options={GRADES.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
            <Col span={6}><Form.Item name="semester" label="学期"><Select allowClear options={SEMESTERS.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="subject" label="科目"><Input placeholder="物理" /></Form.Item></Col>
            <Col span={6}><Form.Item name="exam_type" label="考试类型"><Select allowClear options={EXAM_TYPES.map(v => ({ label: v, value: v }))} /></Form.Item></Col>
            <Col span={6}><Form.Item name="region" label="地区"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="school" label="学校"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="knowledge_ids" label="知识点">
            <Select mode="multiple" allowClear options={knowledgeOptions} placeholder="可多选，无数量上限" />
          </Form.Item>
          <Form.Item name="model_ids" label="模型">
            <Select mode="multiple" allowClear options={modelOptions} placeholder="可多选，无数量上限" />
          </Form.Item>
          <Form.Item name="formulas" label="公式编辑">
            <TextArea rows={3} placeholder="每行一个公式，可填写 LaTeX、Word 公式转写文本或 MathType 转写文本" />
          </Form.Item>
          <Form.Item label="上传/修改图片">
            <Upload
              listType="picture"
              fileList={imageFiles}
              beforeUpload={() => false}
              onChange={({ fileList }) => setImageFiles(fileList)}
            >
              <Button icon={<FileImageOutlined />}>选择图片</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="tags" label="标签"><Input placeholder="逗号分隔" /></Form.Item>
        </Form>
        {questions.length === 0 && <Empty description="暂无试题" />}
      </Modal>
    </Row>
  );
};

export default QuestionBankEdit;
