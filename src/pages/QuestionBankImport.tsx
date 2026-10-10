import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Modal, Form, Input, Select as AntSelect, Space, Tag, message,
  InputNumber, Divider, Checkbox, Collapse, Empty, Row, Col, Typography, Radio, Steps, Alert, Statistic, Drawer
} from 'antd';
import Table from '../components/NumberedTable';
import { FileWordOutlined, CheckCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import type { Question, KnowledgeNode, ImportTask, ImportTaskItem, TaxonomySystem } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import QuestionTaxonomyFields from '../components/QuestionTaxonomyFields';
import { questionTaxonomyPatch, questionTaxonomyValues } from '../services/questionTaxonomyEditing';
import { QUESTION_TYPES, normalizeQuestionType, questionTypeFromParser } from '../constants/questionTypes';
import QuestionStructureEditor from '../components/question-editor/QuestionStructureEditor';
import { normalizeStructureOrder, validateQuestionStructure } from '../components/question-editor/questionStructureOperations';
import { createQuestionRichDocument } from '../types/questionRichContent';
import type { QuestionRichDocument } from '../types/questionRichContent';
import { migrateLegacyQuestion, projectQuestionRichContent } from '../services/questionRichContent';
import { createQuestionEditorSaveGate, createRichDocumentDirtyCoordinator, mergeImportedQuestionMetadata, registerEditorSpaExitGuard, shouldProtectEditorExit } from '../components/question-editor/questionEditorSession'; // utf-8
const { createNativeQuestionDraft } = require('../services/nativeQuestionDraftCreate');
const { applyImportLabels } = require('../../shared/questionImportMetadata');
const { validDifficultyCoefficient, coefficientDifficulty } = require('../../shared/questionDifficulty');
const { createDesktopQuestionImportClient } = require('../services/desktopQuestionImportClient.mjs');
import { collectEditedIntakeMedia, prepareLocalIntakePreview } from '../services/localQuestionIntakePreview';
import {
  downloadImportValidationReport,
  validateImportQuestions,
  mergeImportValidation,
  type ImportValidationRow,
  type ImportValidationSummary,
} from '../services/questionValidation';

const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试', '竞赛', '强基计划', '其他'];
const GRADES = ['高一', '高二', '高三', '复习'];
const SEMESTERS = ['上学期', '下学期'];

const IMPORT_INSTRUCTIONS = {
  lecture: {
    title: '讲义格式导入说明',
    items: ['适合按专题、题号、题干、选项和批注答案解析整理的讲义文件。'],
  },
  exam: {
    title: '试卷格式导入说明',
    items: ['适合整卷导入。选择文件后，会尝试从文件名补全学年、考试类型、年级、学期、地区、学校和试卷名。'],
  },
  topic: {
    title: '专题题集导入说明',
    items: [
      '适合同类题目汇集，答案和详解需紧跟题目。',
      '保留选项、小题、公式和图片，移除题号后开头的来源括号。',
      '共用材料、合并答案却分成多个题号的题组会跳过并提示，不自动拆题。',
    ],
  },
};

type ExamMeta = {
  year?: string;
  exam_type?: string;
  grade?: string;
  semester?: string;
  region?: string;
  school?: string;
  alliance?: string;
  paper_name?: string;
};

type ImportStep = 0 | 1 | 2 | 3;

type ImportCommitResult = {
  id: string;
  imported: number;
  failed: number;
  warning: number;
  created_at: string;
  source_type: 'lecture' | 'exam' | 'topic';
  file_name?: string;
};

type CloudImportTask = {
  taskId: string;
  status: string;
  phase: string;
  sourceStorageState?: string;
  mediaStorageState?: string;
  items?: any[];
  sourceFileName?: string;
  sourceType?: 'lecture' | 'exam';
  metadata?: any;
  processingLocation?: string;
};

type ImportHistoryTask = Omit<ImportTask, 'status'> & { status: string; processing_location?: string };

function importHistoryRow(task: any): ImportHistoryTask {
  return { id: task.taskId, file_name: task.sourceFileName,
    source_type: task.metadata?.importFormat || task.sourceType,
    status: task.status, processing_location: task.processingLocation,
    total_items: task.totalItems ?? task.items?.length ?? 0,
    success_items: task.submittedItems ?? task.items?.filter((item: any) => item.status === 'submitted').length ?? 0,
    warning_items: task.warningItems ?? task.items?.filter((item: any) => item.validation?.status === 'warning').length ?? 0,
    failed_items: task.failedItems ?? task.items?.filter((item: any) => item.status === 'rejected').length ?? 0,
    duplicate_items: 0, created_at: task.createdAt, updated_at: task.updatedAt };
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function toSchoolYear(year?: string): string {
  const match = String(year || '').match(/(19\d{2}|20\d{2})/);
  if (!match) return String(year || '');
  const start = Number(match[1]);
  return `${start}-${start + 1}`;
}

function formatCloudImportValidationCode(code: string): string {
  const messages: Record<string, string> = {
    missing_stem: "未识别到题干，请核对原件",
    missing_answer: "未识别到答案，请核对原件",
    formula_needs_review: "部分公式未能完整转换，请核对后再提交",
  };
  return messages[code] || "导入项需要核对：" + code;
}

function getSchoolYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => {
    const start = current + 1 - i;
    const value = `${start}-${start + 1}`;
    return { value, label: `${value}学年` };
  });
}

function extractExamMetaFromFileName(fileName: string): ExamMeta {
  const name = stripFileExtension(fileName);
  const meta: ExamMeta = { paper_name: name };
  const yearMatch = name.match(/(19\d{2}|20\d{2})/);
  if (yearMatch) meta.year = toSchoolYear(yearMatch[1]);

  const gradeMatch = name.match(/(高一|高二|高三|复习|初一|初二|初三)/);
  if (gradeMatch) meta.grade = gradeMatch[1];

  if (/上学期|上册|第一学期/.test(name)) meta.semester = '上学期';
  if (/下学期|下册|第二学期/.test(name)) meta.semester = '下学期';

  if (/高考真题|真题/.test(name)) meta.exam_type = '高考真题';
  else if (/期中/.test(name)) meta.exam_type = '期中考试';
  else if (/期末/.test(name)) meta.exam_type = '期末考试';
  else if (/月考/.test(name)) meta.exam_type = '月考';
  else if (/开学考/.test(name)) meta.exam_type = '开学考';
  else if (/单元测试|单元/.test(name)) meta.exam_type = '单元测试';
  else if (/模拟|一模|二模|三模|联考|适应性|质量检测|调研|教学测试/.test(name)) meta.exam_type = '模拟题';

  const regionMatch = name.match(/(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|杭州|宁波|温州|绍兴|嘉兴|湖州|金华|台州|丽水|衢州|南京|苏州|无锡|常州|扬州|南通|徐州|成都|深圳|广州)/);
  if (regionMatch) meta.region = regionMatch[1];

  const schoolMatch = name.match(/([\u4e00-\u9fa5]{2,24}(?:中学|高中|学校|外国语|实验学校|教育集团))/);
  if (schoolMatch) meta.school = schoolMatch[1];

  const allianceMatch = name.match(/([\u4e00-\u9fa5]{2,20}(?:十校联盟|联盟|联考))/);
  if (allianceMatch) meta.alliance = allianceMatch[1];

  return meta;
}

function mergeDefinedMeta(current: ExamMeta, incoming: ExamMeta): ExamMeta {
  const next = { ...current };
  (Object.keys(incoming) as Array<keyof ExamMeta>).forEach(key => {
    const value = incoming[key];
    if (value && value !== current[key]) next[key] = value;
  });
  return next;
}

function normalizeQuestion(row: any): Question {
  let options = row.options || [];
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { options = []; }
  }
  if ((!options || options.length === 0) && row.options_json) {
    try { options = JSON.parse(row.options_json); } catch { options = []; }
  }
  return {
    ...row,
    type: normalizeQuestionType(row.type),
    content: row.content ?? row.stem ?? '',
    options: Array.isArray(options) ? options : [],
    analysis: row.analysis ?? row.explanation ?? '',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
    taxonomy_ids: row.taxonomy_ids || {
      knowledge: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
      model: row.model_ids ?? row.model_point_ids ?? [],
    },
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
  } as Question;
}

function getQuestionStem(q: any): string {
  return q.stem || q.content || '';
}

function applyExamMetaToQuestion(q: any, meta: ExamMeta = {}, sourceType: 'lecture' | 'exam' | 'topic') {
  return applyImportLabels(q, meta, sourceType);
}

function statusColor(status: string): string {
  if (['success', 'accepted', 'imported'].includes(status)) return 'green';
  if (['warning', 'duplicate'].includes(status)) return 'orange';
  if (['failed', 'rejected'].includes(status)) return 'red';
  return 'blue';
}

function storageStatusText(status?: string): string {
  return status === 'verified' ? '已归档' : status === 'quarantined' ? '校验失败' : '正在归档';
}

function importTaskStatusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待处理',
    checking: '校验中',
    checked: '已校验',
    importing: '导入中',
    imported: '已导入',
    partial_failed: '部分失败',
    failed: '失败',
    awaiting_source_storage: '原件与图片归档中',
    queued_for_parse: '等待解析',
    parsing: '解析中',
    candidates_ready: '待完成导入',
    drafts_prepared: '正在提交',
    submitted: '已入库',
    quarantined: '存储校验异常',
    cancelled: '已取消',
    accepted: '校验通过',
    warning: '有警告',
    rejected: '校验未通过',
    draft_prepared: '待提交',
  };
  return map[status] || status;
}

const QuestionBankImport: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);
  const [taxonomySubject, setTaxonomySubject] = useState('\u7269\u7406');
  const [taxonomySystems, setTaxonomySystems] = useState<TaxonomySystem[]>([]);
  const [taxonomyNodes, setTaxonomyNodes] = useState<Record<string, KnowledgeNode[]>>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [editingImportKey, setEditingImportKey] = useState<string | null>(null);
  const [richDocument, setRichDocument] = useState<QuestionRichDocument>(() => createQuestionRichDocument());
  const [editorDirty, setEditorDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wordImporting, setWordImporting] = useState(false);
  const [wordResult, setWordResult] = useState<any>(null);
  const [committingBatch, setCommittingBatch] = useState(false);
  const [draftPreparationError, setDraftPreparationError] = useState<string | null>(null);
  const [wordSourceType, setWordSourceType] = useState<'lecture' | 'exam' | 'topic'>('lecture');
  const [selectedWordFile, setSelectedWordFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<ImportStep>(0);
  const [validationRows, setValidationRows] = useState<ImportValidationRow[]>([]);
  const [validationSummary, setValidationSummary] = useState<ImportValidationSummary>({ success: 0, warning: 0, failed: 0, total: 0 });
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [cloudImportTask, setCloudImportTask] = useState<CloudImportTask | null>(null);
  const [recentImportTasks, setRecentImportTasks] = useState<ImportHistoryTask[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [importTaskDetail, setImportTaskDetail] = useState<(ImportHistoryTask & { items: ImportTaskItem[] }) | null>(null);
  const [importTaskDrawerOpen, setImportTaskDrawerOpen] = useState(false);
  const [examPapers] = useState<any[]>([]);
  const [examForm] = Form.useForm();
  const [form] = Form.useForm();
  const saveGate = useRef(createQuestionEditorSaveGate()).current;
  const richDirtyCoordinator = useRef(createRichDocumentDirtyCoordinator(null)).current;
  const formDirtyRef = useRef(false);
  const editorQuestionType = Form.useWatch('type', form);
  const editorSubject = Form.useWatch('subject', form) || taxonomySubject;
  const editorSystems: TaxonomySystem[] = (window as any).dbService?.getTaxonomySystems?.(editorSubject) || [];
  const editorNodes = Object.fromEntries(editorSystems.map(system => [system.id, (window as any).dbService?.getTaxonomyNodes?.(system.id) || []]));
  const handleTaxonomiesChanged = useCallback((systems: TaxonomySystem[], nodes: Record<string, KnowledgeNode[]>) => {
    setTaxonomySystems(systems);
    setTaxonomyNodes(nodes);
    setKnowledgeNodes(nodes.knowledge || []);
    setModelNodes(nodes.model || []);
  }, []);

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
      if (!shouldProtectEditorExit(modalVisible, editorDirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDirtyEditor);
    return () => window.removeEventListener('beforeunload', protectDirtyEditor);
  }, [modalVisible, editorDirty]);
  useEffect(() => registerEditorSpaExitGuard(() => shouldProtectEditorExit(modalVisible, editorDirty)), [modalVisible, editorDirty]);
  const examMetaRef = useRef<any>(null);
  const localIntakeRef = useRef<any>(null);
  const stagedIntakeRef = useRef<any>(null);
  const intakeClientRef = useRef<any>(null);
  const intakeClient = () => {
    if (!intakeClientRef.current) intakeClientRef.current = createDesktopQuestionImportClient();
    return intakeClientRef.current;
  };
  const preparedDraftItemsRef = useRef(new Set<string>());
  const intakeEpochRef = useRef(0);
  const historyEpochRef = useRef(0);
  const detailRequestRef = useRef(0);
  const preparationBusyRef = useRef(false);
  useEffect(() => () => { intakeEpochRef.current++; historyEpochRef.current++; detailRequestRef.current++; }, []);

  const loadImportHistory = async () => {
    const epoch = historyEpochRef.current;
    setHistoryLoading(true);
    try {
      const tasks = await intakeClient().list();
      if (epoch !== historyEpochRef.current) return;
      setRecentImportTasks(tasks.map(importHistoryRow));
      setHistoryError('');
      return tasks;
    } catch (error: any) {
      if (epoch === historyEpochRef.current) setHistoryError('\u5bfc\u5165\u8bb0\u5f55\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\uff0c\u8bf7\u8054\u7f51\u540e\u91cd\u8bd5\uff1a' + (error.message || 'unknown error'));
    } finally { if (epoch === historyEpochRef.current) setHistoryLoading(false); }
  };

  const loadData = useCallback(async () => {
    try {
      const db = (window as any).dbService;
      try {
        const remoteQuestions = await (window as any).desktopIdentitySessionProvider?.listCloudQuestions?.();
        setQuestions(Array.isArray(remoteQuestions) ? remoteQuestions.map(normalizeQuestion) : []);
      } catch (_err) {
        setQuestions([]);
      }
      if (!db) return;
      const kn = db.getKnowledgeTree?.() || [];
      setKnowledgeNodes(kn);
      if (kn.length === 0) {
        db.initDefaultKnowledgeTree?.();
        setKnowledgeNodes(db.getKnowledgeTree?.() || []);
      }
      const models = db.getModelTree?.() || [];
      setModelNodes(models);
      if (models.length === 0) {
        db.initDefaultModelTree?.();
        setModelNodes(db.getModelTree?.() || []);
      }
    } catch (e) {
      console.error('QuestionBankImport loadData error:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
    window.addEventListener('authority-projection-refreshed', loadData);
    return () => window.removeEventListener('authority-projection-refreshed', loadData);
  }, [loadData]);

  useEffect(() => {
    const reloadTaxonomy = () => {
      const db = (window as any).dbService;
      const systems: TaxonomySystem[] = db?.getTaxonomySystems?.(taxonomySubject) || [];
      handleTaxonomiesChanged(systems, Object.fromEntries(systems.map(system => [system.id, db?.getTaxonomyNodes?.(system.id) || []])));
    };
    reloadTaxonomy();
    window.addEventListener('authority-projection-refreshed', reloadTaxonomy);
    return () => window.removeEventListener('authority-projection-refreshed', reloadTaxonomy);
  }, [taxonomySubject, handleTaxonomiesChanged]);

  // Knowledge tree checkbox renderer in modal
  const handleSave = async () => {
    const structureErrors = validateQuestionStructure(richDocument, form.getFieldValue('type'));
    if (structureErrors.length > 0) { message.error(structureErrors[0]); return; }
    const values = await form.validateFields();
    const db = (window as any).dbService;
    const projection = projectQuestionRichContent(richDocument);

    const originalQuestion = editingImportKey ? validationRows.find(row => row.key === editingImportKey)?.question : editing;
    const taxonomyPatch = questionTaxonomyPatch(originalQuestion || {}, values.taxonomy_ids || {});
    const { model_ids } = taxonomyPatch;

    const data: any = {
      subject: values.subject,
      type: normalizeQuestionType(values.type),
      difficulty: coefficientDifficulty(values.difficulty_coefficient) ?? originalQuestion?.difficulty ?? 3,
      difficulty_coefficient: values.difficulty_coefficient ?? null,
      content: projection.stem,
      options: projection.options.map(option => ({ label: option.label, content: option.content, is_correct: option.isCorrect })),
      answer: projection.answer,
      analysis: projection.explanation,
      sub_questions: projection.subQuestions,
      rich_content: richDocument,
      ...taxonomyPatch,
      knowledge_point: values.knowledge_point || '',
      model_point: model_ids.length > 0 ? modelNodes.find(n => n.id === model_ids[0])?.name || '' : '',
      formulas: projection.formulas,
      tags: originalQuestion?.tags || [],
      source: values.source || '',
      year: values.year || '',
      grade: values.grade || '',
      semester: values.semester || '',
      exam_type: values.exam_type || '',
      status: editing?.status || 'draft',
      has_image: projection.hasImage,
      has_formula: projection.hasFormula,
      created_by: editing?.created_by || '',
    };

    if (editingImportKey) {
      const row = validationRows.find(item => item.key === editingImportKey);
      const mergedQuestion = row ? mergeImportedQuestionMetadata(row.question, data) : data;
      if (row) {
        const nextQuestions = (wordResult?.questions || []).map((item: any, index: number) => index === row.index - 1
          ? { ...mergeImportedQuestionMetadata(item, data), stem: data.content, question_types: [data.type] } : item);
        const validation = validateImportQuestions(nextQuestions, questions);
        setWordResult((current: any) => ({ ...current, questions: nextQuestions }));
        setValidationRows(validation.rows);
        setValidationSummary(validation.summary);
      } else {
        const validation = validateImportQuestions([mergedQuestion], questions);
        setValidationRows(validation.rows); setValidationSummary(validation.summary);
      }
    } else if (editing) {
      db.updateQuestion(editing.id, data);
    } else {
      try { await createNativeQuestionDraft(db, data); } catch (_error) { message.error('DRAFT_PROVENANCE_UNAVAILABLE'); return; }
    }
    richDirtyCoordinator.markSaved(richDocument);
    formDirtyRef.current = false;
    setModalVisible(false);
    setEditing(null);
    setEditingImportKey(null);
    setRichDocument(createQuestionRichDocument());
    setEditorDirty(false);
    form.resetFields();
    loadData();
    message.success('题目已保存'); // utf-8
  };

  const openImportedQuestionEditor = (row: ImportValidationRow) => {
    const question: any = row.question;
    const questionSubject = question.subject || '\u7269\u7406';
    const db = (window as any).dbService;
    const questionSystems: TaxonomySystem[] = db?.getTaxonomySystems?.(questionSubject) || [];
    const questionNodes: Record<string, KnowledgeNode[]> = Object.fromEntries(
      questionSystems.map(system => [system.id, db?.getTaxonomyNodes?.(system.id) || []]),
    );
    setTaxonomySubject(questionSubject);
    handleTaxonomiesChanged(questionSystems, questionNodes);
    setEditing(null); setEditingImportKey(row.key); openRichDocument(normalizeStructureOrder(question.rich_content?.type === 'question-document' ? createQuestionRichDocument(question.rich_content) : migrateLegacyQuestion(question)));
    form.setFieldsValue({ subject: questionSubject, type: question.type ? normalizeQuestionType(question.type) : questionTypeFromParser(question.question_types), difficulty_coefficient: question.difficulty_coefficient ?? null, taxonomy_ids: questionTaxonomyValues(question), tags: (question.tags || []).join(','), source: question.source, year: question.year, grade: question.grade, semester: question.semester, exam_type: question.exam_type });
    setModalVisible(true);
  };

  const startLocalIntake = async (file: File, examMeta?: ExamMeta) => {
    if (wordImporting || committingBatch) return;
    intakeEpochRef.current++;
    examMetaRef.current = examMeta || null;
    localIntakeRef.current = null;
    stagedIntakeRef.current = null;
    preparedDraftItemsRef.current.clear();
    setCloudImportTask(null);
    setWordImporting(true);
    setWordResult(null);
    setValidationRows([]);
    setValidationSummary({ success: 0, warning: 0, failed: 0, total: 0 });
    setCommitResult(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await intakeClient().parseFromWord({ sourceType: wordSourceType, sourceFileName: file.name, bytes });
      const candidates = (await prepareLocalIntakePreview(parsed)).map(question => applyExamMetaToQuestion(question, examMeta || {}, wordSourceType));
      const validation = validateImportQuestions(candidates, questions);
      localIntakeRef.current = { bytes, parsed, sourceType: wordSourceType === 'topic' ? 'lecture' : wordSourceType, sourceFileName: file.name,
        sourceMimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        metadata: { ...(examMeta || {}), sourceFileName: file.name, importFormat: wordSourceType } };
      setWordResult({ questions: candidates, count: candidates.length, quality_report: parsed.qualityReport });
      setValidationRows(validation.rows);
      setValidationSummary(validation.summary);
      setImportStep(2);
      if (candidates.length) message.success('本机解析与图片清理完成，请校对后确认导入；在线时会自动提交。');
      else message.warning('没有可独立导入的试题，请查看跳过提示。');
    } catch (error: any) {
      message.error((error.code || error.message) === 'QUESTION_INTAKE_DOC_CONVERSION_REQUIRED'
        ? '旧版 .doc 文件请先另存为 .docx 后再导入。'
        : '本机解析失败: ' + (error.message || 'unknown error'));
    } finally { setWordImporting(false); }
  };

  const refreshCloudImportTask = async () => {
    if (!cloudImportTask || committingBatch) return;
    const epoch = intakeEpochRef.current;
    try {
      const task = await intakeClient().read(cloudImportTask.taskId) as CloudImportTask;
      if (epoch !== intakeEpochRef.current) return;
      setCloudImportTask(task);
      if (localIntakeRef.current) return;
      if (!Array.isArray(task.items) || task.items.length === 0) {
        message.info('\u4e91\u7aef\u4efb\u52a1\u5f53\u524d\u9636\u6bb5: ' + task.phase);
        return;
      }
      const candidates = task.items.map((item: any) => item.candidate || {});
      const validation = validateImportQuestions(candidates, questions);
      const rows = validation.rows.map((row, index) => {
        const remote = task.items?.[index];
        return mergeImportValidation(row, remote?.validation, formatCloudImportValidationCode);
      });
      const summary = rows.reduce<ImportValidationSummary>((acc, row) => {
        acc[row.status] += 1; acc.total += 1; return acc;
      }, { success: 0, warning: 0, failed: 0, total: 0 });
      setWordResult({ questions: candidates, count: candidates.length });
      setValidationRows(rows);
      setValidationSummary(summary);
    } catch (error: any) {
      message.error('\u8bfb\u53d6\u4e91\u7aef\u5bfc\u5165\u4efb\u52a1\u5931\u8d25: ' + (error.message || 'unknown error'));
    }
  };

  const prepareCloudImportDrafts = async () => {
    if (validationSummary.failed > 0 || !wordResult || commitResult || committingBatch || preparationBusyRef.current) return;
    const db = (window as any).dbService;
    if (!db) { message.error('本地草稿库未就绪'); return; }
    intakeEpochRef.current++;
    preparationBusyRef.current = true;
    const epoch = intakeEpochRef.current;
    setCommittingBatch(true);
    setDraftPreparationError(null);
    try {
      const client = intakeClient();
      let task = cloudImportTask;
      if (localIntakeRef.current) {
        if (!stagedIntakeRef.current) {
          const collected = await collectEditedIntakeMedia(localIntakeRef.current.parsed, wordResult.questions);
          stagedIntakeRef.current = await client.withEditedCandidates(collected, collected.candidates.map((item: any) => item.candidate));
        }
        if (!task) {
          task = await client.createFromParsed({ ...localIntakeRef.current, parsed: stagedIntakeRef.current });
          setCloudImportTask(task);
        } else {
          await client.resumeMedia(await client.read(task.taskId), stagedIntakeRef.current);
        }
        if (!task) throw new Error('QUESTION_INTAKE_TASK_UNAVAILABLE');
        task = await client.read(task.taskId);
        setCloudImportTask(task);
      }
      if (epoch !== intakeEpochRef.current) return;
      if (!task || !['candidates_ready', 'drafts_prepared'].includes(task.status) || task.sourceStorageState !== 'verified'
        || (task.processingLocation === 'desktop' && task.mediaStorageState !== 'verified')
        || (localIntakeRef.current && task.mediaStorageState !== 'verified')) {
        message.info('原件与图片正在归档；校验完成后会自动继续导入。');
        return;
      }
      const prepared = (task.status === 'drafts_prepared'
        ? { ...task, items: (task.items || []).filter((item: any) => item.status === 'draft_prepared') }
        : await client.prepareDrafts(task.taskId)) as CloudImportTask;
      const existingDrafts = db.getAllQuestions?.() || [];
      for (const item of prepared.items || []) {
        if (epoch !== intakeEpochRef.current) return;
        if (existingDrafts.some((draft: any) => draft.import_task_id === prepared.taskId && draft.import_item_id === item.itemId)) {
          preparedDraftItemsRef.current.add(item.itemId);
        }
        if (preparedDraftItemsRef.current.has(item.itemId)) continue;
        const localCandidate = localIntakeRef.current ? item.candidate : (wordResult?.questions?.[item.itemIndex] || item.candidate || {});
        const mediaByIndex = new Map((item.mediaManifest || []).map((media: any) => [media.assetIndex, media]));
        const assets = (item.candidate.assets || []).map((asset: any) => ({ ...asset, content_hash: asset.contentHash,
          file_name: asset.fileName, asset_type: asset.assetType, mime_type: asset.mimeType, size_bytes: asset.sizeBytes,
          ...(mediaByIndex.get(asset.assetIndex) || {}) }));
        await createNativeQuestionDraft(db, {
          ...localCandidate, subject: localCandidate.subject || '物理', type: localCandidate.type || questionTypeFromParser(localCandidate.question_types),
          rich_content: item.candidate.rich_content,
          content: localCandidate.content ?? localCandidate.stem ?? '', analysis: localCandidate.analysis || localCandidate.explanation || '',
          assets,
          import_task_id: prepared.taskId,
          import_item_id: item.itemId,
          import_item_index: item.itemIndex,
          import_content_hash: item.contentHash,
        });
        preparedDraftItemsRef.current.add(item.itemId);
      }
      const created = preparedDraftItemsRef.current.size;
      setCloudImportTask({ ...task, ...prepared });
      setImportStep(3);
      setCommitResult({ id: prepared.taskId, imported: created, failed: validationSummary.failed, warning: validationSummary.warning, created_at: new Date().toISOString(), source_type: wordSourceType, file_name: selectedWordFile?.name || task.sourceFileName });
      loadData();
      window.dispatchEvent(new Event('desktop-authority-drafts-changed'));
      message.success('已准备 ' + created + ' 道题目，在线时会静默提交；离线修改联网后才需整体确认。');
    } catch (error: any) {
      if (error.task) setCloudImportTask(error.task);
      const detail = error.code === 'CLOUD_BUSINESS_INPUT_INVALID' || error.message === 'CLOUD_BUSINESS_INPUT_INVALID'
        ? '云端未通过导入数据校验，本批题目尚未全部生成草稿。解析结果仍保留在下方，请修复后重试。'
        : '本批题目尚未全部生成草稿，解析结果仍保留在下方，可重试。错误：' + (error.message || '未知错误');
      setDraftPreparationError(detail);
      message.error('生成待提交草稿失败');
    } finally {
      preparationBusyRef.current = false;
      if (epoch === intakeEpochRef.current) { intakeEpochRef.current++; setCommittingBatch(false); }
    }
  };

  const handleSelectWordFile = (file: File) => {
    if (wordImporting || committingBatch || shouldProtectEditorExit(modalVisible, editorDirty)) return;
    intakeEpochRef.current++;
    localIntakeRef.current = null;
    stagedIntakeRef.current = null;
    preparedDraftItemsRef.current.clear();
    setCloudImportTask(null);
    setSelectedWordFile(file);
    setDraftPreparationError(null);
    setWordResult(null);
    setValidationRows([]);
    setValidationSummary({ success: 0, warning: 0, failed: 0, total: 0 });
    setCommitResult(null);
    setImportStep(1);
    if (wordSourceType === 'exam') {
      const current = examForm.getFieldsValue();
      const next = mergeDefinedMeta(current, extractExamMetaFromFileName(file.name));
      examForm.setFieldsValue(next);
      message.success('已选择文件，并尝试从文件名补全试卷信息');
    } else {
      message.success('已选择文件，请点击开始解析');
    }
  };

  const openWordFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.doc,.docx';
    input.style.display = 'none';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) handleSelectWordFile(file);
      input.remove();
    };
    input.addEventListener('cancel', () => input.remove(), { once: true });
    document.body.appendChild(input);
    input.click();
  };

  const handleStartParse = () => {
    if (!selectedWordFile) {
      message.warning('请先选择 Word 文件');
      return;
    }
    const meta = wordSourceType === 'exam' ? examForm.getFieldsValue() : undefined;
    startLocalIntake(selectedWordFile, meta);
  };

  const restoreImportTask = async (taskId: string) => {
    if (committingBatch || wordImporting || preparationBusyRef.current) return;
    const epoch = ++intakeEpochRef.current;
    try {
      const task = await intakeClient().read(taskId) as CloudImportTask;
      if (epoch !== intakeEpochRef.current) return;
      localIntakeRef.current = null;
      stagedIntakeRef.current = null;
      preparedDraftItemsRef.current.clear();
      setSelectedWordFile(null);
      setDraftPreparationError(null);
      setCommitResult(null);
      const format = task.metadata?.importFormat || task.sourceType;
      setWordSourceType(format === 'exam' || format === 'topic' ? format : 'lecture');
      examMetaRef.current = task.metadata || null;
      setCloudImportTask(task);
      const candidates = (task.items || []).map((item: any) => item.candidate || {});
      const validation = validateImportQuestions(candidates, (window as any).dbService?.getAllQuestions?.() || []);
      const rows = validation.rows.map((row, index) => mergeImportValidation(row, task.items?.[index]?.validation, formatCloudImportValidationCode));
      setWordResult({ questions: candidates, count: candidates.length });
      setValidationRows(rows);
      setValidationSummary(rows.reduce<ImportValidationSummary>((summary, row) => {
        summary[row.status]++; summary.total++; return summary;
      }, { success: 0, warning: 0, failed: 0, total: 0 }));
      setImportStep(task.status === 'submitted' ? 3 : 2);
    } catch (error: any) {
      if (epoch === intakeEpochRef.current) setHistoryError('\u6062\u590d\u5bfc\u5165\u4efb\u52a1\u5931\u8d25\uff1a' + (error.message || 'unknown error'));
    }
  };

  useEffect(() => {
    const epoch = intakeEpochRef.current;
    void loadImportHistory().then(tasks => {
      if (epoch !== intakeEpochRef.current) return;
      const pending = tasks?.find((task: any) => task.processingLocation === 'desktop'
        && ['awaiting_source_storage', 'candidates_ready', 'drafts_prepared'].includes(task.status));
      if (pending) void restoreImportTask(pending.taskId);
    });
  }, []);

  useEffect(() => {
    if (!cloudImportTask || committingBatch || preparationBusyRef.current || draftPreparationError
      || ['submitted', 'failed', 'cancelled', 'quarantined'].includes(cloudImportTask.status)) return;
    const ready = ['candidates_ready', 'drafts_prepared'].includes(cloudImportTask.status)
      && cloudImportTask.sourceStorageState === 'verified'
      && (cloudImportTask.processingLocation !== 'desktop' || cloudImportTask.mediaStorageState === 'verified');
    if (ready && wordResult && !commitResult && validationSummary.failed === 0) {
      void prepareCloudImportDrafts();
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshCloudImportTask().then(() => loadImportHistory());
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [cloudImportTask, committingBatch, draftPreparationError, wordResult, commitResult, validationSummary.failed]);

  useEffect(() => {
    const refresh = () => { void loadImportHistory(); };
    window.addEventListener('authority-projection-refreshed', refresh);
    return () => window.removeEventListener('authority-projection-refreshed', refresh);
  }, []);

  const openImportTaskDetail = async (task: ImportHistoryTask) => {
    setImportTaskDetail({ ...task, items: [] });
    setImportTaskDrawerOpen(true);
    const epoch = historyEpochRef.current;
    const request = ++detailRequestRef.current;
    try {
      const detail = await intakeClient().read(task.id);
      if (epoch !== historyEpochRef.current || request !== detailRequestRef.current) return;
      setImportTaskDetail({ ...importHistoryRow(detail), items: (detail.items || []).map((item: any) => ({
        id: item.itemId, task_id: detail.taskId, item_index: item.itemIndex, content_hash: item.contentHash,
        status: item.status === 'submitted' ? 'imported' : item.status, quality_score: 0,
        payload: item.candidate, errors: item.validation?.status === 'rejected' ? item.validation.codes || [] : [],
        warnings: item.validation?.status === 'warning' ? item.validation.codes || [] : [],
        created_at: detail.createdAt, updated_at: detail.updatedAt,
      })) });
    } catch (error: any) {
      if (epoch === historyEpochRef.current && request === detailRequestRef.current) setHistoryError('\u8bfb\u53d6\u5bfc\u5165\u8be6\u60c5\u5931\u8d25\uff1a' + (error.message || 'unknown error'));
    }
  };

  return (
    <Row gutter={[16, 16]} className="question-bank-import-layout">
      {/* Main Content */}
      <Col span={24}>
        <Card style={{ margin: 0 }}>

          <Steps
            current={importStep}
            style={{ marginBottom: 20 }}
            items={[
              { title: '选择文件' },
              { title: '选择类型' },
              { title: '解析与校对' },
              { title: '归档与入库' },
            ]}
          />

          <div style={{ background: '#f7f9fc', border: '1px solid #e8edf3', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <Row gutter={[20, 16]} align="top">
              <Col xs={24} lg={wordSourceType === 'exam' ? 9 : 24}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileWordOutlined style={{ fontSize: 22, color: '#1890ff' }} />
                    <Text strong>导入格式</Text>
                  </div>
                  <Radio.Group
                    value={wordSourceType}
                    disabled={wordImporting || committingBatch || modalVisible}
                    onChange={e => {
                      setWordSourceType(e.target.value);
                      intakeEpochRef.current++;
                      localIntakeRef.current = null;
                      stagedIntakeRef.current = null;
                      preparedDraftItemsRef.current.clear();
                      setCloudImportTask(null);
                      setImportStep(selectedWordFile ? 1 : 0);
                      setWordResult(null);
                      setValidationRows([]);
                      setValidationSummary({ success: 0, warning: 0, failed: 0, total: 0 });
                      setCommitResult(null);
                    }}
                    buttonStyle="solid"
                  >
                    <Radio.Button value="lecture">讲义格式</Radio.Button>
                    <Radio.Button value="exam">试卷格式</Radio.Button>
                    <Radio.Button value="topic">专题题集</Radio.Button>
                  </Radio.Group>
                  <Collapse ghost size="small" defaultActiveKey={['instructions']} items={[{ key: 'instructions', label: IMPORT_INSTRUCTIONS[wordSourceType].title, children: <ul style={{ margin: 0, paddingLeft: 18, color: '#666', lineHeight: 1.8 }}>
                    {IMPORT_INSTRUCTIONS[wordSourceType].items.map(instruction => <li key={instruction}>{instruction}</li>)}
                    <li>开始解析在本机读取文档、清理微小标识并保留图片显示尺寸；校对后生成草稿时才归档原件和图片。</li>
                  </ul> }]} />
                  {selectedWordFile && (
                    <Space wrap size={4}>
                    <Tag color="blue" style={{ whiteSpace: 'normal', lineHeight: 1.6 }}>
                      已选择：{selectedWordFile.name}
                    </Tag>
                    {!wordResult && <Button type="link" size="small" disabled={wordImporting || committingBatch || modalVisible}
                      onClick={() => { setSelectedWordFile(null); setImportStep(0); }}>
                      {'\u53d6\u6d88\u9009\u62e9'}
                    </Button>}
                    </Space>
                  )}
                </Space>
              </Col>
              {/* UTF-8: keep form state connected while hiding irrelevant exam metadata. */}
              <Col xs={24} lg={15} style={{ display: wordSourceType === 'exam' ? undefined : 'none' }}>
                <Form form={examForm} layout="vertical" disabled={wordSourceType !== 'exam' || wordImporting || committingBatch || !!wordResult} initialValues={{ year: toSchoolYear(new Date().getFullYear().toString()) }}>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name="year" label="学年"><Select options={getSchoolYearOptions()} /></Form.Item></Col>
                    <Col span={8}><Form.Item name="exam_type" label="考试类型"><Select options={EXAM_TYPES.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
                    <Col span={8}><Form.Item name="grade" label="年级"><Select options={GRADES.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name="semester" label="学期"><Select options={SEMESTERS.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
                    <Col span={8}><Form.Item name="region" label="地区"><Input placeholder="如：浙江" /></Form.Item></Col>
                    <Col span={8}><Form.Item name="alliance" label="联盟"><Input placeholder="如：十校联盟" /></Form.Item></Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={12}><Form.Item name="school" label="学校"><Input placeholder="如：杭州某中学" /></Form.Item></Col>
                    <Col span={12}><Form.Item name="paper_name" label="试卷名"><Input placeholder="选择文件后自动填入文件名，也可手动修改" /></Form.Item></Col>
                  </Row>
                </Form>
              </Col>
            </Row>
          </div>

          {/* 已有试卷列表 */}
          {wordSourceType === 'exam' && examPapers.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Divider orientation="left">已有试卷</Divider>
              <Table
                size="small"
                rowKey="id"
                dataSource={examPapers.slice(0, 10)}
                pagination={false}
                scroll={{ y: 200 }}
                columns={[
                  { title: '试卷名', dataIndex: 'name', ellipsis: true },
                  { title: '学年', dataIndex: 'year', width: 90 },
                  { title: '年级', dataIndex: 'grade', width: 70 },
                  { title: '考试类型', dataIndex: 'exam_type', width: 90 },
                  { title: '地区', dataIndex: 'region', width: 70 },
                  { title: '联盟', dataIndex: 'alliance', width: 90 },
                  { title: '学校', dataIndex: 'school', width: 100 },
                  {
                    title: '操作',
                    width: 80,
                    render: (_: any, record: any) => (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          examForm.setFieldsValue({
                            year: record.year || '',
                            exam_type: record.exam_type || '',
                            grade: record.grade || '',
                            semester: record.semester || '',
                            region: record.region || '',
                            school: record.school || '',
                            alliance: record.alliance || '',
                            paper_name: record.name || '',
                          });
                          message.success('已自动填充试卷信息');
                        }}
                      >
                        填充
                      </Button>
                    ),
                  },
                ]}
              />
            </div>
          )}

          <div
            style={{ textAlign: 'center', padding: '42px 20px', border: '2px dashed #d9d9d9', borderRadius: 8, background: '#fafafa' }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              handleSelectWordFile(file);
            }}
          >
            <FileWordOutlined style={{ fontSize: 64, color: '#1890ff' }} />
            <h3 style={{ marginTop: 16 }}>拖拽或选择 Word 文件</h3>
            <p style={{ color: '#999' }}>支持 .docx；旧版 .doc 请先另存为 .docx。当前模式：{wordSourceType === 'lecture' ? '讲义格式' : wordSourceType === 'topic' ? '专题题集' : '试卷格式'}</p>
            <Space>
              <Button size="large" icon={<FileWordOutlined />} disabled={wordImporting || committingBatch || modalVisible} onClick={openWordFilePicker}>
                选择文件
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                loading={wordImporting}
                disabled={!selectedWordFile || !wordSourceType || committingBatch || modalVisible}
                onClick={handleStartParse}
              >
                开始解析
              </Button>
            </Space>
          </div>

          {wordResult?.quality_report?.topic_collection?.skipped_groups?.length > 0 && (
            <Alert showIcon type="warning" style={{ marginTop: 16 }} message={'\u5df2\u8df3\u8fc7\u65e0\u6cd5\u72ec\u7acb\u62c6\u5206\u7684\u9898\u7ec4'}
              description={<ul style={{ margin: 0, paddingLeft: 18 }}>
                {wordResult.quality_report.topic_collection.skipped_groups.map((group: any, index: number) => (
                  <li key={index}>{'\u539f\u6587\u9898\u53f7 ' + group.numbers.join('\u3001') + '\uff1a\u5171\u7528\u6750\u6599\u6216\u5408\u5e76\u7b54\u6848\uff0c\u4e0d\u4f5c\u4e3a\u72ec\u7acb\u8bd5\u9898\u5bfc\u5165\uff1b\u8bf7\u6574\u7406\u4e3a\u4e00\u9053\u542b\u5c0f\u9898\u7684\u5b8c\u6574\u8bd5\u9898\u540e\u91cd\u65b0\u5bfc\u5165\u3002'}</li>
                ))}
              </ul>} />
          )}
          {wordResult?.quality_report?.image_cleanup && (
            <Alert showIcon type="info" style={{ marginTop: 16 }} message={`本机图片清理：已移除 ${wordResult.quality_report.image_cleanup.removed_count || 0} 处微小标识图片`}
              description="正常题图保留录入文档中的显示尺寸；原件内容保持不变。" />
          )}

          {cloudImportTask && (
            <Alert
              showIcon
              type={cloudImportTask.status === 'candidates_ready' ? 'success' : 'info'}
              message={'原件归档：' + storageStatusText(cloudImportTask.sourceStorageState) + '；图片归档：' + storageStatusText(cloudImportTask.mediaStorageState)}
              description={<Button size="small" disabled={committingBatch} onClick={refreshCloudImportTask}>{'刷新存储状态'}</Button>}
              style={{ marginTop: 16 }}
            />
          )}

          {(validationRows.length > 0 || commitResult) && (
            <div style={{ marginTop: 16 }}>
              <Divider orientation="left">预校验与准备草稿</Divider>
              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col span={6}><Card size="small"><Statistic title="总题数" value={validationSummary.total} /></Card></Col>
                <Col span={6}><Card size="small"><Statistic title="可导入" value={validationSummary.success} valueStyle={{ color: '#3f8600' }} /></Card></Col>
                <Col span={6}><Card size="small"><Statistic title="警告" value={validationSummary.warning} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
                <Col span={6}><Card size="small"><Statistic title="失败" value={validationSummary.failed} valueStyle={{ color: '#cf1322' }} /></Card></Col>
              </Row>
              {validationSummary.failed > 0 ? (
                <Alert showIcon type="error" message="存在失败题目，确认导入已禁用" description="请先处理空题干等失败项，或导出错误报告后重新整理文件。" style={{ marginBottom: 12 }} />
              ) : validationRows.length > 0 ? (
                <Alert showIcon type={validationSummary.warning > 0 ? 'warning' : 'success'} message={validationSummary.warning > 0 ? '存在警告项，可确认后继续导入' : '预校验通过，可以确认导入'} style={{ marginBottom: 12 }} />
              ) : null}
              {validationRows.length > 0 && (
                <>
                  {draftPreparationError && <Alert showIcon type="error" message="草稿生成未完成" description={draftPreparationError} style={{ marginBottom: 12 }} />}
                  <Table
                    size="small"
                    rowKey="key"
                    dataSource={validationRows}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: '原文题号', dataIndex: 'index', width: 70 },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        width: 90,
                        render: (status: string) => <Tag color={statusColor(status)}>{status === 'success' ? '成功' : status === 'warning' ? '警告' : '失败'}</Tag>,
                      },
                      {
                        title: '题干',
                        render: (_: any, row: ImportValidationRow) => <Text ellipsis style={{ maxWidth: 360 }}>{getQuestionStem(row.question) || '空题干'}</Text>,
                      },
                      {
                        title: '问题',
                        render: (_: any, row: ImportValidationRow) => (
                          <Space wrap size={4}>
                            {row.issues.length === 0 ? <Tag color="green">通过</Tag> : row.issues.map((issue, idx) => (
                              <Tag key={idx} color={issue.level === 'failed' ? 'red' : 'orange'}>{issue.message}</Tag>
                            ))}
                          </Space>
                        ),
                      },
                      {
                        title: '编辑', // utf-8
                        width: 72,
                        render: (_: any, row: ImportValidationRow) => <Button size="small" type="link" disabled={committingBatch || !!stagedIntakeRef.current || !!cloudImportTask || !!commitResult} onClick={() => openImportedQuestionEditor(row)}>编辑</Button>,
                      },
                    ]}
                  />
                  <Space style={{ marginTop: 12 }}>
                    <Button icon={<DownloadOutlined />} onClick={() => downloadImportValidationReport(validationRows)}>导出错误报告</Button>
                    <Button type="primary" loading={committingBatch} disabled={!wordResult || validationSummary.failed > 0 || !!commitResult || modalVisible} onClick={prepareCloudImportDrafts}>
                      确认导入
                    </Button>
                  </Space>
                </>
              )}
              {commitResult && (
                <Alert
                  style={{ marginTop: 12 }}
                  type="success"
                  showIcon
                  message={cloudImportTask?.status === 'submitted' || recentImportTasks.some(task => task.id === commitResult.id && task.status === 'submitted') ? `已入库：${commitResult.imported} 题` : `正在自动提交：${commitResult.imported} 题`}
                  description={`${commitResult.file_name ? `文件：${commitResult.file_name}。` : ''}在线时静默提交云端题库，入库后可在题库和编辑打标页面查看；只有离线修改在恢复联网后需整体确认一次。`}
                />
              )}
            </div>
          )}

          {/* 最近导入记录 */}
          {(
            <div style={{ marginTop: 16 }}>
              <Divider orientation="left">最近导入</Divider>
              <Button size="small" loading={historyLoading} onClick={() => { void loadImportHistory(); }} style={{ marginBottom: 12 }}>刷新记录</Button>
              {historyError && <Alert showIcon type="warning" message={historyError} style={{ marginBottom: 12 }} />}
              {recentImportTasks.length > 0 ? (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={recentImportTasks}
                  pagination={false}
                  columns={[
                    { title: '文件', dataIndex: 'file_name', render: (v: string) => v || '-' },
                    { title: '类型', dataIndex: 'source_type', width: 90, render: (v: string) => v === 'exam' ? '试卷' : v === 'topic' ? '专题题集' : '讲义' },
                    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusColor(v)}>{importTaskStatusText(v)}</Tag> },
                    { title: '总数', dataIndex: 'total_items', width: 70 },
                    { title: '已入库', dataIndex: 'success_items', width: 80 },
                    { title: '警告', dataIndex: 'warning_items', width: 70 },
                    { title: '失败', dataIndex: 'failed_items', width: 70 },
                    { title: '时间', dataIndex: 'created_at', width: 170, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
                    { title: '操作', width: 170, render: (_: any, record: ImportHistoryTask) => <Space><Button type="link" onClick={() => { void openImportTaskDetail(record); }}>详情</Button>{['awaiting_source_storage', 'candidates_ready', 'drafts_prepared'].includes(record.status) && <Button type="link" disabled={committingBatch || wordImporting} onClick={() => { void restoreImportTask(record.id); }}>继续导入</Button>}</Space> },
                  ]}
                />
              ) : (
                <Empty description={historyLoading ? "正在读取导入记录" : "暂无导入记录"} />
              )}
            </div>
          )}
        </Card>
      </Col>

      {/* 试卷格式导入 — 需填写试卷元信息 */}

      <Drawer
        title="导入任务详情"
        placement="right"
        width={620}
        open={importTaskDrawerOpen}
        onClose={() => setImportTaskDrawerOpen(false)}
      >
        {importTaskDetail ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Card size="small">
              <Space wrap>
                <Tag color={statusColor(importTaskDetail.status)}>{importTaskStatusText(importTaskDetail.status)}</Tag>
                <span>文件：{importTaskDetail.file_name || '-'}</span>
                <span>总数：{importTaskDetail.total_items}</span>
                <span>警告：{importTaskDetail.warning_items}</span>
                <span>失败：{importTaskDetail.failed_items}</span>
              </Space>
            </Card>
            <Table
              size="small"
              rowKey="id"
              dataSource={importTaskDetail.items || []}
              pagination={{ pageSize: 10, showSizeChanger: false, showQuickJumper: true, showTotal: total => `共 ${total} 题` }}
              columns={[
                { title: '原文题号', dataIndex: 'item_index', width: 70, render: (v: number) => Number(v || 0) + 1 },
                { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusColor(v)}>{importTaskStatusText(v)}</Tag> },
                {
                  title: '题干',
                  render: (_: any, row: ImportTaskItem) => (
                    <Text ellipsis style={{ maxWidth: 260 }}>{getQuestionStem(row.payload || {}) || '-'}</Text>
                  ),
                },
                {
                  title: '问题',
                  render: (_: any, row: ImportTaskItem) => (
                    <Space wrap size={4}>
                      {(row.errors || []).map(item => <Tag key={`e-${item}`} color="red">{item}</Tag>)}
                      {(row.warnings || []).map(item => <Tag key={`w-${item}`} color="orange">{item}</Tag>)}
                      {(!row.errors?.length && !row.warnings?.length && !row.error_message) ? <Tag color="green">通过</Tag> : null}
                      {row.error_message ? <Tag color="red">{row.error_message}</Tag> : null}
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        ) : <Empty description="暂无导入详情" />}
      </Drawer>

      {/* Add/Edit Modal */}
      <Modal
        title={editingImportKey ? '校对录入试题' : editing ? '编辑题目' : '添加题目'}
        open={modalVisible}
        wrapClassName="taxonomy-edit-modal"
        onOk={async () => { setSaving(true); const result = await saveGate(handleSave); if (!result.ok && result.owned) message.error(`\u4fdd\u5b58\u5931\u8d25\uff1a${(result.error as any)?.message || '\u8bf7\u91cd\u8bd5'}`); if (result.owned) setSaving(false); }}
        onCancel={() => {
          const close = () => { setModalVisible(false); setEditing(null); setEditingImportKey(null); setRichDocument(createQuestionRichDocument()); setEditorDirty(false); form.resetFields(); };
          if (!editorDirty) close();
          else Modal.confirm({ title: '\u5c1a\u6709\u672a\u4fdd\u5b58\u7684\u4fee\u6539', content: '\u786e\u5b9a\u79bb\u5f00\u5417\uff1f', onOk: close });
        }}
        confirmLoading={saving}
        maskClosable={!editorDirty}
        keyboard={!editorDirty}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onValuesChange={markFormDirty}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="subject" label="科目" rules={[{ required: true }]}>
                <Select>{SUBJECTS.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="type" label="题型" rules={[{ required: true }]}>
                <Select>{QUESTION_TYPES.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="difficulty_coefficient" label="难度系数" rules={[{ validator: (_rule, value) => validDifficultyCoefficient(value ?? null) ? Promise.resolve() : Promise.reject(new Error('系数必须在 0 到 1 之间')) }]}>
                <InputNumber min={0} max={1} step={0.01} placeholder="0 ~ 1" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* utf-8 rich structure */}
          <QuestionStructureEditor value={richDocument} disabled={saving} questionType={editorQuestionType} wholeQuestionAnswer={wordSourceType === 'topic'} onChange={updateRichDocument} />

          <Divider orientation="left" style={{ fontSize: 12 }}>扩展信息</Divider>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="exam_type" label="考试类型">
                <Select allowClear>{EXAM_TYPES.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="grade" label="年级">
                <Select allowClear>{GRADES.map(g => <Select.Option key={g} value={g}>{g}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="year" label="学年"><Input placeholder="2025-2026" /></Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="semester" label="学期">
                <Select allowClear>{SEMESTERS.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="taxonomy_ids" label="体系标签">
            <QuestionTaxonomyFields systems={editorSystems} nodes={editorNodes} disabled={saving} />
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
};

export default QuestionBankImport;
