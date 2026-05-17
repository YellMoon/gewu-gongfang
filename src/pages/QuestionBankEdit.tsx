import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Empty, Form, Input, InputNumber, Modal, Select as AntSelect,
  Space, Tag, Upload, message
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { FileImageOutlined, FunctionOutlined, TagsOutlined } from '@ant-design/icons';
import type { KnowledgeNode, Question, QuestionVersion } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import QuestionPreviewCard from '../components/QuestionPreviewCard';
import QuestionRichContent from '../components/QuestionRichContent';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType } from '../constants/questionTypes';

const { TextArea } = Input;
const Select = AutoCloseSelect as typeof AntSelect;
const API_BASE = getApiBase('/api/question-bank');

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试', '竞赛', '强基计划', '其他'];
const GRADES = ['高一', '高二', '高三', '复习'];
const SEMESTERS = ['上学期', '下学期'];

function isPendingEditQuestion(question: Question): boolean {
  const status = String(question.edit_status || '未编辑').trim().toLowerCase();
  return !['已编辑', 'edited', 'done', 'completed'].includes(status);
}

function normalizeOptions(options: any): any[] {
  if (Array.isArray(options)) return options;
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed) ? parsed : options.split('\n').filter(Boolean);
    } catch (_err) {
      return options.split('\n').filter(Boolean);
    }
  }
  return [];
}

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    content: row.content ?? row.stem ?? '',
    options: normalizeOptions(row.options || row.options_json),
    answer: row.answer ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    edit_status: row.edit_status || '未编辑',
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
    assets: row.assets || [],
    formulas: row.formulas || [],
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
  const [trashQuestions, setTrashQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);
  const [editing, setEditing] = useState<Question | null>(null);
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [trashVisible, setTrashVisible] = useState(false);
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();

  const knowledgeOptions = useMemo(() => buildTreeOptions(knowledgeNodes), [knowledgeNodes]);
  const modelOptions = useMemo(() => buildTreeOptions(modelNodes), [modelNodes]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const db = (window as any).dbService;
    const localQuestions = db?.getAllQuestions?.()?.map(normalizeQuestion) || [];
    try {
      const res = await fetch(`${API_BASE}/questions?limit=500`);
      const data = await res.json();
      const remoteQuestions = data.success && Array.isArray(data.data) ? data.data.map(normalizeQuestion) : [];
      const merged = new Map<string, Question>();
      for (const question of localQuestions) merged.set(question.id, question);
      for (const question of remoteQuestions) merged.set(question.id, question);
      const rows = merged.size > 0 ? [...merged.values()] : localQuestions;
      setQuestions(rows.filter(isPendingEditQuestion));
    } catch (_err) {
      setQuestions(localQuestions.filter(isPendingEditQuestion));
    }
    setKnowledgeNodes(db?.getKnowledgeTree?.() || []);
    setModelNodes(db?.getModelTree?.() || []);
    setLoading(false);
  }, []);

  const loadTrash = useCallback(async () => {
    const db = (window as any).dbService;
    try {
      const res = await fetch(`${API_BASE}/questions-trash`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setTrashQuestions(data.data.map(normalizeQuestion));
        return;
      }
    } catch (_err) {
      // use local fallback below
    }
    setTrashQuestions(db?.getDeletedQuestions?.()?.map(normalizeQuestion) || []);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openEditor = (question: Question) => {
    const db = (window as any).dbService;
    setEditing(question);
    setVersions(db?.getLatestQuestionVersions?.(question.id, 5) || []);
    setImageFiles([]);
    form.setFieldsValue({
      content: question.content,
      answer: question.answer,
      analysis: question.analysis,
      options: (question.options || []).map((item: any) => typeof item === 'string' ? item : `${item.label || ''}. ${item.content || item.text || ''}`).join('\n'),
      type: normalizeQuestionType(question.type),
      difficulty: question.difficulty || 3,
      source: question.source,
      year: question.year,
      grade: question.grade,
      semester: question.semester,
      exam_type: question.exam_type || '其他',
      region: question.region,
      school: question.school,
      subject: question.subject || '物理',
      knowledge_ids: question.knowledge_ids || [],
      model_ids: question.model_ids || [],
      formulas: (question.formulas || []).map((item: any) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n'),
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
      has_formula: !!editing.has_formula || !!values.formulas,
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
    const db = (window as any).dbService;
    try {
      const res = await fetch(`${API_BASE}/questions/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '后端保存失败');
    } catch (_err) {
      db?.updateQuestion?.(editing.id, { ...payload, content: payload.stem, analysis: payload.explanation });
    }
    message.success('试题已保存');
    setEditing(null);
    form.resetFields();
    loadData();
  };

  const deleteQuestion = async (question: Question) => {
    const db = (window as any).dbService;
    try {
      const res = await fetch(`${API_BASE}/questions/${question.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '删除失败');
    } catch (_err) {
      db?.deleteQuestion?.(question.id);
    }
    message.success('试题已放入回收站，7天内可撤回');
    loadData();
  };

  const restoreQuestion = async (question: Question) => {
    const db = (window as any).dbService;
    try {
      const res = await fetch(`${API_BASE}/questions/${question.id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '恢复失败');
    } catch (_err) {
      db?.restoreQuestion?.(question.id);
    }
    message.success('试题已恢复');
    loadTrash();
    loadData();
  };

  const applyBatchTags = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择试题');
      return;
    }
    const values = await batchForm.validateFields();
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
        region: values.region ?? q.region ?? '',
        school: values.school ?? q.school ?? '',
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

  return (
    <Card
      title="试题编辑"
      extra={
        <Space>
          <Button onClick={() => { setTrashVisible(true); loadTrash(); }}>回收站</Button>
          <Tag color="orange">待编辑 {questions.length} 题</Tag>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small" title="批量标注">
          <Form form={batchForm} layout="inline">
            <Form.Item name="knowledge_ids" label="知识点">
              <Select mode="multiple" style={{ minWidth: 220 }} options={knowledgeOptions} />
            </Form.Item>
            <Form.Item name="model_ids" label="模型">
              <Select mode="multiple" style={{ minWidth: 220 }} options={modelOptions} />
            </Form.Item>
            <Form.Item name="year" label="学年">
              <Input style={{ width: 120 }} placeholder="2025-2026" />
            </Form.Item>
            <Form.Item name="exam_type" label="考试类型">
              <Select style={{ width: 130 }} options={EXAM_TYPES.map(v => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" icon={<TagsOutlined />} onClick={applyBatchTags} disabled={selectedRowKeys.length === 0}>
                批量应用
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {loading ? <Card loading /> : questions.length === 0 ? (
          <Empty description="暂无待编辑试题" />
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {questions.map((question, index) => (
              <QuestionPreviewCard
                key={question.id}
                question={question}
                index={index}
                knowledgeNames={(question.knowledge_ids || []).map(id => knowledgeNodes.find(item => item.id === id)?.name || id)}
                modelNames={(question.model_ids || []).map(id => modelNodes.find(item => item.id === id)?.name || id)}
                onEdit={() => openEditor(question)}
                onDelete={() => deleteQuestion(question)}
              />
            ))}
          </Space>
        )}
      </Space>

      <Modal
        open={trashVisible}
        title="回收站"
        footer={null}
        width={920}
        onCancel={() => setTrashVisible(false)}
      >
        {trashQuestions.length === 0 ? <Empty description="回收站暂无试题" /> : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {trashQuestions.map((question, index) => (
              <QuestionPreviewCard
                key={question.id}
                question={question}
                index={index}
                showAnswer={false}
                knowledgeNames={(question.knowledge_ids || []).map(id => knowledgeNodes.find(item => item.id === id)?.name || id)}
                modelNames={(question.model_ids || []).map(id => modelNodes.find(item => item.id === id)?.name || id)}
                onEdit={() => restoreQuestion(question)}
                editLabel="恢复"
              />
            ))}
          </Space>
        )}
      </Modal>

      <Modal
        open={!!editing}
        title="编辑试题"
        onCancel={() => setEditing(null)}
        onOk={saveQuestion}
        width={980}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="content" label="题干" rules={[{ required: true, message: '请输入题干' }]}>
            <TextArea rows={5} />
          </Form.Item>
          <Form.Item name="answer" label="答案">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="analysis" label="解析">
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="options" label="选项">
            <TextArea rows={3} placeholder="每行一个选项" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="subject" label="科目" style={{ width: 120 }}>
              <Select options={SUBJECTS.map(v => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="type" label="题型" style={{ width: 130 }}>
              <Select options={QUESTION_TYPES.map(v => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="difficulty" label="难度" style={{ width: 110 }}>
              <InputNumber min={1} max={5} />
            </Form.Item>
            <Form.Item name="year" label="学年" style={{ width: 130 }}>
              <Input placeholder="2025-2026" />
            </Form.Item>
            <Form.Item name="grade" label="年级" style={{ width: 120 }}>
              <Select options={GRADES.map(v => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="semester" label="学期" style={{ width: 120 }}>
              <Select options={SEMESTERS.map(v => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="exam_type" label="考试类型" style={{ width: 130 }}>
              <Select options={EXAM_TYPES.map(v => ({ value: v, label: v }))} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="region" label="地区"><Input /></Form.Item>
            <Form.Item name="school" label="学校"><Input /></Form.Item>
            <Form.Item name="source" label="来源"><Input /></Form.Item>
          </Space>
          <Form.Item name="knowledge_ids" label="知识点">
            <Select mode="multiple" options={knowledgeOptions} />
          </Form.Item>
          <Form.Item name="model_ids" label="模型">
            <Select mode="multiple" options={modelOptions} />
          </Form.Item>
          <Form.Item name="formulas" label={<span><FunctionOutlined /> 公式</span>}>
            <TextArea rows={2} placeholder="可录入 LaTeX 或公式说明" />
          </Form.Item>
          {editing && <QuestionRichContent question={editing} />}
          <Form.Item label={<span><FileImageOutlined /> 图片</span>}>
            <Upload
              listType="picture"
              fileList={imageFiles}
              beforeUpload={() => false}
              onChange={({ fileList }) => setImageFiles(fileList)}
            >
              <Button>上传图片</Button>
            </Upload>
          </Form.Item>
          {versions.length > 0 && (
            <Card size="small" title="最近版本">
              <Space wrap>
                {versions.map(version => <Tag key={version.id}>v{version.version_no} {new Date(version.created_at).toLocaleString()}</Tag>)}
              </Space>
            </Card>
          )}
        </Form>
      </Modal>
    </Card>
  );
};

export default QuestionBankEdit;
