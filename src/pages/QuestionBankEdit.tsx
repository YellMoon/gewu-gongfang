// utf-8
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Checkbox, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select as AntSelect,
  Space, Tag, Upload, message, Pagination, Typography
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { DeleteOutlined, FileImageOutlined, TagsOutlined } from '@ant-design/icons';
import type { KnowledgeNode, Question, QuestionVersion } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import QuestionPreviewCard from '../components/QuestionPreviewCard';
import QuestionRichContent from '../components/QuestionRichContent';
import QuestionStructureEditor from '../components/question-editor/QuestionStructureEditor';
import { mergeQuestionAssets, normalizeStructureOrder, validateQuestionStructure } from '../components/question-editor/questionStructureOperations';
import { createQuestionEditorSaveGate, createRichDocumentDirtyCoordinator, persistRemoteThenLocal, registerEditorSpaExitGuard, shouldProtectEditorExit } from '../components/question-editor/questionEditorSession'; // utf-8
import { createQuestionRichDocument } from '../types/questionRichContent';
import type { QuestionRichDocument } from '../types/questionRichContent';
import { migrateLegacyQuestion, projectQuestionRichContent } from '../services/questionRichContent';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType } from '../constants/questionTypes';
import {
  cacheQuestionTrees,
  ensureQuestionLocalStoreSeeded,
  getCachedQuestionTree,
  queryQuestionPage,
  removeQuestionLocalRecord,
} from '../services/questionLocalStore';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
const { questionDeletePresentation } = require('../services/questionDeletionPresentation');
const { deleteQuestionViaApi } = require('../services/questionDeleteApi');
const { normalizeDesktopQuestionDeleteContext, verifyNativeQuestionDraft } = require('../services/desktopQuestionDeleteContext');

const Select = AutoCloseSelect as typeof AntSelect;
const API_BASE = getApiBase('/api/question-bank');
const QUESTION_PAGE_SIZE = 10;
const { Text } = Typography;

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

function initialRichDocument(question: Question): QuestionRichDocument {
  if (question.rich_content?.type === 'question-document') return normalizeStructureOrder(createQuestionRichDocument(question.rich_content));
  const document = migrateLegacyQuestion(question as any);
  document.sections.options = document.sections.options.map((item, index) => ({ ...item, id: `option-${index}-${question.id}` }));
  document.sections.subQuestions = document.sections.subQuestions.map((item, index) => ({ ...item, id: `sub-${index}-${question.id}` }));
  return normalizeStructureOrder(document);
}

const QuestionBankEdit: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [localStoreReady, setLocalStoreReady] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [trashQuestions, setTrashQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);
  const [editing, setEditing] = useState<Question | null>(null);
  const [richDocument, setRichDocument] = useState<QuestionRichDocument | null>(null);
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [trashPage, setTrashPage] = useState(1);
  const [imageFiles, setImageFiles] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [trashVisible, setTrashVisible] = useState(false);
  const [deleteContext, setDeleteContext] = useState<{ capabilities: string[]; deviceId?: string; userId?: string }>({ capabilities: [] });
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  const [modalApi, modalContextHolder] = Modal.useModal(); // utf-8
  const saveGate = React.useRef(createQuestionEditorSaveGate()).current;
  const richDirtyCoordinator = React.useRef(createRichDocumentDirtyCoordinator(null)).current;
  const formDirtyRef = React.useRef(false);
  const editorQuestionType = Form.useWatch('type', form);

  const openRichDocument = (document: QuestionRichDocument) => {
    richDirtyCoordinator.reset(document);
    formDirtyRef.current = false;
    setRichDocument(document);
    setEditorDirty(false);
  };
  const updateRichDocument = (document: QuestionRichDocument) => {
    const richState = richDirtyCoordinator.update(document);
    setRichDocument(document);
    setEditorDirty(formDirtyRef.current || richState.dirty);
  };
  const markFormDirty = () => {
    formDirtyRef.current = true;
    setEditorDirty(true);
  };

  useEffect(() => {
    const protectDirtyEditor = (event: BeforeUnloadEvent) => {
      if (!shouldProtectEditorExit(Boolean(editing), editorDirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDirtyEditor);
    return () => window.removeEventListener('beforeunload', protectDirtyEditor);
  }, [editing, editorDirty]);
  useEffect(() => registerEditorSpaExitGuard(() => shouldProtectEditorExit(Boolean(editing), editorDirty)), [editing, editorDirty]);

  useEffect(() => {
    try {
      const session = readDesktopAuthorizationSession();
      fetch('/api/permissions/my', { headers: { authorization: session.authorization, 'x-device-id': session.authContext.deviceId } })
        .then(response => response.json()).then(data => setDeleteContext(normalizeDesktopQuestionDeleteContext(session, data.capabilities)))
        .catch(() => undefined);
    } catch (_error) {}
  }, []);

  const knowledgeOptions = useMemo(() => buildTreeOptions(knowledgeNodes), [knowledgeNodes]);
  const modelOptions = useMemo(() => buildTreeOptions(modelNodes), [modelNodes]);
  const totalPages = Math.max(1, Math.ceil(questionTotal / QUESTION_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleQuestions = questions;
  const visibleIds = useMemo(() => visibleQuestions.map(question => question.id), [visibleQuestions]);
  const selectedVisibleCount = visibleIds.filter(id => selectedRowKeys.includes(id)).length;
  const trashTotalPages = Math.max(1, Math.ceil(trashQuestions.length / QUESTION_PAGE_SIZE));
  const safeTrashPage = Math.min(trashPage, trashTotalPages);
  const visibleTrashQuestions = useMemo(() => trashQuestions.slice((safeTrashPage - 1) * QUESTION_PAGE_SIZE, safeTrashPage * QUESTION_PAGE_SIZE), [trashQuestions, safeTrashPage]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const db = (window as any).dbService; // utf-8 atomic save
    const cachedKnowledge = await getCachedQuestionTree('knowledge');
    const cachedModels = await getCachedQuestionTree('model');
    if (cachedKnowledge.length > 0) setKnowledgeNodes(cachedKnowledge);
    if (cachedModels.length > 0) setModelNodes(cachedModels);
    const kn = db?.getKnowledgeTree?.() || [];
    const models = db?.getModelTree?.() || [];
    if (kn.length > 0) setKnowledgeNodes(kn);
    if (models.length > 0) setModelNodes(models);
    cacheQuestionTrees(kn, models).catch(() => undefined);
    await ensureQuestionLocalStoreSeeded(() => db?.getAllQuestions?.()?.map(normalizeQuestion) || []);
    setLocalStoreReady(true);
    setRefreshNonce(value => value + 1);
    setLoading(false);
    try {
      const res = await fetch(`${API_BASE}/questions?limit=500`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        // 服务端同步仅后台预热本地索引，首屏不等待接口结果。
        setRefreshNonce(value => value + 1);
      }
    } catch (_err) {
      // 本地优先，接口失败不影响编辑页打开。
    }
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
  useEffect(() => { setCurrentPage(1); }, [questionTotal]);
  useEffect(() => { setTrashPage(1); }, [trashQuestions.length]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const jumpToQuestionPage = useCallback((page: number) => {
    setCurrentPage(page);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, []);

  const refreshQuestionPage = useCallback(async () => {
    if (!localStoreReady) return;
    setLoading(true);
    try {
      const result = await queryQuestionPage({
        page: currentPage,
        pageSize: QUESTION_PAGE_SIZE,
        pendingEditOnly: true,
      });
      setQuestionTotal(result.total);
      setQuestions(result.rows.map(normalizeQuestion).filter(isPendingEditQuestion));
    } finally {
      setLoading(false);
    }
  }, [localStoreReady, refreshNonce, currentPage]);

  useEffect(() => { refreshQuestionPage(); }, [refreshQuestionPage]);

  const openEditor = (question: Question) => {
    const db = (window as any).dbService;
    setEditing(question);
    openRichDocument(initialRichDocument(question));
    setVersions(db?.getLatestQuestionVersions?.(question.id, 5) || []);
    setImageFiles([]);
    form.setFieldsValue({
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
      tags: (question.tags || []).join(','),
    });
  };

  const saveQuestion = async () => {
    if (!editing || !richDocument) return;
    const structureErrors = validateQuestionStructure(richDocument, form.getFieldValue('type'));
    if (structureErrors.length > 0) {
      message.error(structureErrors[0]);
      return;
    }
    const values = await form.validateFields();
    const projection = projectQuestionRichContent(richDocument);
    const payload: any = {
      stem: projection.stem,
      subject: values.subject || '物理',
      content: projection.stem,
      answer: projection.answer,
      explanation: projection.explanation,
      analysis: projection.explanation,
      options: projection.options.map(option => ({ label: option.label, content: option.content, is_correct: option.isCorrect })),
      sub_questions: projection.subQuestions,
      rich_content: richDocument,
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
      has_formula: projection.hasFormula,
      created_by: editing.created_by || '',
      formulas: projection.formulas,
      tags: values.tags ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      assets: mergeQuestionAssets(editing.assets || [], imageFiles.map(file => ({
        asset_type: 'image',
        file_name: file.name,
        mime_type: file.type || 'image/*',
        oss_key: `local-question-images/${editing.id}/${file.name}`,
        oss_url: file.url || file.thumbUrl || '',
      }))),
    };
    const db = (window as any).dbService;
    if (!db?.updateQuestion) throw new Error('LOCAL_QUESTION_STORE_UNAVAILABLE');
    await persistRemoteThenLocal(
      () => fetch(`${API_BASE}/questions/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      () => db.updateQuestion(editing.id, { ...payload, content: payload.stem, analysis: payload.explanation }),
    );
    message.success('试题已保存');
    richDirtyCoordinator.markSaved(richDocument);
    formDirtyRef.current = false;
    setEditing(null);
    setRichDocument(null);
    setEditorDirty(false);
    form.resetFields();
    loadData();
  };

  const closeEditor = () => {
    const close = () => {
      setEditing(null);
      setRichDocument(null);
      setEditorDirty(false);
      form.resetFields();
    };
    if (!editorDirty) { close(); return; }
    modalApi.confirm({
      title: '\u5c1a\u6709\u672a\u4fdd\u5b58\u7684\u4fee\u6539',
      content: '\u79bb\u5f00\u540e\u672c\u6b21\u4fee\u6539\u5c06\u4e22\u5931\uff0c\u786e\u5b9a\u79bb\u5f00\u5417\uff1f',
      okText: '\u79bb\u5f00', cancelText: '\u7ee7\u7eed\u7f16\u8f91', okButtonProps: { danger: true }, onOk: close,
    });
  };

  const deleteQuestion = async (question: Question) => {
    const presentation = questionDeletePresentation(question, deleteContext);
    if (!presentation.enabled) { message.warning(presentation.reason); return; }
    const db = (window as any).dbService;
    let deleted = false;
    if (question.storage_state === 'host_committed') {
      try {
        const session = readDesktopAuthorizationSession();
        deleted = (await deleteQuestionViaApi(fetch, `${API_BASE}/questions/${question.id}`, {
          token: session.authorization.replace(/^Bearer\s+/i, ''), deviceId: session.authContext.deviceId,
        })).ok;
      } catch (_error) { deleted = false; }
    } else {
      const session = readDesktopAuthorizationSession();
      deleted = Boolean(db?.deleteQuestion?.(question.id, await verifyNativeQuestionDraft(question.id, session)));
      if (deleted) await removeQuestionLocalRecord(question.id, deleteContext);
    }
    if (!deleted) { message.error('Delete failed'); return; }
    setQuestions(prev => prev.filter(item => item.id !== question.id));
    setQuestionTotal(prev => Math.max(0, prev - 1));
    setSelectedRowKeys(prev => prev.filter(id => id !== question.id));
  };

  const toggleQuestionSelection = useCallback((id: string, checked: boolean) => {
    setSelectedRowKeys(prev => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter(item => item !== id);
    });
  }, []);

  const toggleVisibleSelection = useCallback((checked: boolean) => {
    setSelectedRowKeys(prev => {
      const set = new Set(prev);
      if (checked) {
        visibleIds.forEach(id => set.add(id));
      } else {
        visibleIds.forEach(id => set.delete(id));
      }
      return [...set];
    });
  }, [visibleIds]);

  const batchDeleteQuestions = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择试题');
      return;
    }
    const ids = selectedRowKeys.filter(id => {
      const question = questions.find(item => item.id === id);
      return question && questionDeletePresentation(question, deleteContext).enabled;
    });
    if (ids.length === 0) { message.warning('No selected question can be deleted from this device'); return; }
    const db = (window as any).dbService;
    const session = JSON.parse(sessionStorage.getItem('gewu_desktop_authorization_session') || 'null') || {};
    const settled = await Promise.allSettled(ids.map(async id => {
      const question = questions.find(item => item.id === id);
      const ok = question?.storage_state === 'host_committed'
        ? (await deleteQuestionViaApi(fetch, `${API_BASE}/questions/${id}`, session)).ok
        : Boolean(db?.deleteQuestion?.(id, await verifyNativeQuestionDraft(id, readDesktopAuthorizationSession())));
      if (!ok) throw new Error('DELETE_FAILED');
      if (question?.storage_state === 'local_draft') await removeQuestionLocalRecord(id, deleteContext);
      return id;
    }));
    const succeeded = settled.filter((item): item is PromiseFulfilledResult<string> => item.status === 'fulfilled').map(item => item.value);
    setQuestions(prev => prev.filter(item => !succeeded.includes(item.id)));
    setQuestionTotal(prev => Math.max(0, prev - succeeded.length));
    setSelectedRowKeys(prev => prev.filter(id => !succeeded.includes(id)));
    message.info(`Deleted ${succeeded.length}; failed ${selectedRowKeys.length - succeeded.length}`);
  };

  const disabledDangerousDataClear = async () => {
    const db = (window as any).dbService;
    void db;
    message.success('已清空试题、试卷和导入测试数据');
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
    <>
    {modalContextHolder}
    <Card
      title="试题编辑"
      extra={
        <Space>
          <Button onClick={() => { setTrashVisible(true); loadTrash(); }}>回收站</Button>
          {false && (
          <Popconfirm
            title="确定清空试题和试卷测试数据？"
            description="调试用操作，会删除试题、试题篮、导入批次和试卷组卷信息。"
            okText="清空"
            cancelText="取消"
            onConfirm={disabledDangerousDataClear}
          >
            <Button danger icon={<DeleteOutlined />}>清空调试数据</Button>
          </Popconfirm>
          )}
          <Tag color="orange">待编辑 {questionTotal} 题</Tag>
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

        <Card size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Space wrap>
            <Checkbox
              checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length}
              indeterminate={selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length}
              onChange={event => toggleVisibleSelection(event.target.checked)}
            >
              全选本页
            </Checkbox>
            <Tag color={selectedRowKeys.length > 0 ? 'blue' : 'default'}>已选 {selectedRowKeys.length} 题</Tag>
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 道试题？`}
              okText="删除"
              cancelText="取消"
              onConfirm={batchDeleteQuestions}
              disabled={selectedRowKeys.length === 0}
            >
              <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0}>
                批量删除
              </Button>
            </Popconfirm>
          </Space>
          <Space wrap>
            <Text type="secondary">共 {questionTotal} 题，第 {safeCurrentPage}/{totalPages} 页</Text>
          </Space>
          </div>
        </Card>

        {loading ? <Card loading /> : questionTotal === 0 ? (
          <Empty description="暂无待编辑试题" />
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div style={{ width: '100%', overflowX: 'visible', paddingBottom: 6 }}>
              <div style={{ minWidth: '100%' }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {visibleQuestions.map((question, index) => (
              <QuestionPreviewCard
                key={question.id}
                question={question}
                index={(safeCurrentPage - 1) * QUESTION_PAGE_SIZE + index}
                selectable
                checked={selectedRowKeys.includes(question.id)}
                onCheckChange={checked => toggleQuestionSelection(question.id, checked)}
                knowledgeNames={(question.knowledge_ids || []).map(id => knowledgeNodes.find(item => item.id === id)?.name || id)}
                modelNames={(question.model_ids || []).map(id => modelNodes.find(item => item.id === id)?.name || id)}
                onEdit={() => openEditor(question)}
                onDelete={questionDeletePresentation(question, deleteContext).visible ? () => deleteQuestion(question) : undefined}
              />
            ))}
                </Space>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <Pagination
                current={safeCurrentPage}
                total={questionTotal}
                pageSize={QUESTION_PAGE_SIZE}
                showSizeChanger={false}
                showQuickJumper
                showTotal={total => `共 ${total} 题`}
                onChange={jumpToQuestionPage}
              />
            </div>
            {false && (
              <Button block onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>
                加载更多（已显示 {visibleQuestions.length}/{questionTotal}）
              </Button>
            )}
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
            {visibleTrashQuestions.map((question, index) => (
              <QuestionPreviewCard
                key={question.id}
                question={question}
                index={(safeTrashPage - 1) * QUESTION_PAGE_SIZE + index}
                showAnswer={false}
                knowledgeNames={(question.knowledge_ids || []).map(id => knowledgeNodes.find(item => item.id === id)?.name || id)}
                modelNames={(question.model_ids || []).map(id => modelNodes.find(item => item.id === id)?.name || id)}
                onEdit={() => restoreQuestion(question)}
                editLabel="恢复"
              />
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <Pagination
                current={safeTrashPage}
                total={trashQuestions.length}
                pageSize={QUESTION_PAGE_SIZE}
                showSizeChanger={false}
                showQuickJumper
                showTotal={total => `共 ${total} 题`}
                onChange={page => setTrashPage(page)}
              />
            </div>
          </Space>
        )}
      </Modal>

      <Modal
        open={!!editing}
        title="编辑试题"
        onCancel={closeEditor}
        onOk={async () => {
          setSaving(true);
          const result = await saveGate(saveQuestion);
          if (!result.ok) message.error(`\u4fdd\u5b58\u5931\u8d25\uff1a${(result.error as any)?.message || '\u8bf7\u68c0\u67e5\u8fde\u63a5\u540e\u91cd\u8bd5'}`);
          if (result.owned) setSaving(false);
        }}
        confirmLoading={saving}
        maskClosable={!editorDirty}
        keyboard={!editorDirty}
        width={980}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onValuesChange={markFormDirty}>
          {richDocument && <QuestionStructureEditor
            value={richDocument}
            disabled={saving}
            questionType={editorQuestionType}
            onChange={updateRichDocument}
          />}
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
    </>
  );
};

export default QuestionBankEdit;
