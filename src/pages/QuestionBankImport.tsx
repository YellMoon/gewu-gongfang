import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Modal, Form, Input, InputNumber, Select as AntSelect, Space, Tag, message,
  Tree, Divider, Checkbox, Empty, Row, Col, Typography, Table, Tooltip, Radio, Steps, Alert, Statistic, Drawer
} from 'antd';
import {
  PlusOutlined, FileWordOutlined, BookOutlined, FormOutlined,
  FileAddOutlined, CheckCircleOutlined, BranchesOutlined, FolderOpenOutlined,
  DeleteOutlined, EditOutlined, CloseCircleOutlined, DownloadOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode, ImportTask, ImportTaskItem } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType, questionTypeFromParser } from '../constants/questionTypes';
import QuestionRenderer from '../components/QuestionRenderer';
import { prepareQuestionAssetsForStorage, stripQuestionAssetPayload } from '../services/questionAssetStore';
import { reconcileQuestionLocalStore } from '../services/questionLocalStore';
import {
  downloadImportValidationReport,
  validateImportQuestions,
  type ImportValidationRow,
  type ImportValidationSummary,
} from '../services/questionValidation';

const { TextArea } = Input;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试', '竞赛', '强基计划', '其他'];
const GRADES = ['高一', '高二', '高三', '复习'];
const SEMESTERS = ['上学期', '下学期'];

const API_BASE = getApiBase('/api/question-bank');
const PARSE_WORD_ENDPOINT = `${API_BASE}/parse-word`;

type ImportBatch = {
  id: string;
  status: string;
  total_items: number;
  accepted_items: number;
  warning_items?: number;
  failed_items?: number;
  duplicate_items: number;
  rejected_items: number;
  quality_report?: any;
  commit_result?: any;
  items?: any[];
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
  source_type: 'lecture' | 'exam';
  file_name?: string;
};

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function toSchoolYear(year?: string): string {
  const match = String(year || '').match(/(19\d{2}|20\d{2})/);
  if (!match) return String(year || '');
  const start = Number(match[1]);
  return `${start}-${start + 1}`;
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

// Build tree data for Ant Design Tree
function buildTreeData(nodes: KnowledgeNode[], parentId?: string): any[] {
  return nodes
    .filter(n => n.parent_id === parentId || (!parentId && !n.parent_id))
    .sort((a, b) => a.order - b.order)
    .map(n => ({
      key: n.id,
      title: n.name,
      children: buildTreeData(nodes, n.id),
      isLeaf: false,
    }));
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
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
  } as Question;
}

function toServerQuestion(q: any, meta: any = {}) {
  return {
    subject: q.subject || '物理',
    subject_id: q.subject_id || null,
    chapter_id: q.chapter_id || null,
    type: questionTypeFromParser(q.question_types),
    difficulty: q.difficulty || 3,
    stem: q.stem || q.content || '',
    options: q.options || [],
    answer: q.answer || '',
    explanation: q.explanation || q.analysis || '',
    source: q.source || '',
    year: q.year || meta.year || '',
    grade: q.grade || meta.grade || '',
    semester: q.semester || meta.semester || '',
    exam_type: q.exam_type || meta.exam_type || '\u5176\u4ed6',
    region: q.region || meta.region || '',
    school: q.school || meta.school || '',
    alliance: q.alliance || meta.alliance || '',
    paper_name: q.paper_name || meta.paper_name || '',
    paper_id: q.paper_id || meta.paper_id || '',
    question_number: q.question_number || q.number || null,
    status: q.status || 'draft',
    has_image: !!q.has_image,
    has_formula: !!q.has_formula,
    created_by: q.created_by || '',
    formulas: q.formulas || [],
    assets: q.assets || [],
    allow_tag_name_create: false,
    knowledge_point_ids: q.knowledge_point_ids || q.knowledge_ids || [],
    model_point_ids: q.model_point_ids || q.model_ids || [],
  };
}

function normalizeImportedKnowledgeIds(db: any, parsedQuestion: any): string[] {
  const names = parsedQuestion.knowledge_points || (parsedQuestion.knowledge_point ? [parsedQuestion.knowledge_point] : []);
  const knowledgeTree = db.getKnowledgeTree?.() || [];
  const ids = new Set<string>((parsedQuestion.knowledge_ids || parsedQuestion.knowledge_point_ids || []).filter(Boolean));
  for (const name of names || []) {
    const text = String(name || '').trim();
    if (!text) continue;
    const node = knowledgeTree.find((n: any) => n.name === text);
    if (node?.id) ids.add(node.id);
  }
  return [...ids];
}

function getQuestionStem(q: any): string {
  return q.stem || q.content || '';
}

function applyExamMetaToQuestion(q: any, meta: ExamMeta = {}, sourceType: 'lecture' | 'exam') {
  if (sourceType !== 'exam') return q;
  return {
    ...q,
    year: toSchoolYear(q.year || meta.year || ''),
    grade: q.grade || meta.grade || '',
    semester: q.semester || meta.semester || '',
    exam_type: q.exam_type || meta.exam_type || '其他',
    region: q.region || meta.region || '',
    school: q.school || meta.school || '',
    alliance: q.alliance || meta.alliance || '',
    paper_name: q.paper_name || meta.paper_name || '',
    question_number: q.question_number || q.number || null,
    source: q.source || meta.paper_name || '',
  };
}

function statusColor(status: string): string {
  if (['success', 'accepted', 'imported'].includes(status)) return 'green';
  if (['warning', 'duplicate'].includes(status)) return 'orange';
  if (['failed', 'rejected'].includes(status)) return 'red';
  return 'blue';
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
  };
  return map[status] || status;
}

const QuestionBankImport: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeName, setEditingNodeName] = useState('');
  const [addingChildParentId, setAddingChildParentId] = useState<string | null | '__ROOT__'>(null);
  const [addingChildName, setAddingChildName] = useState('');
  const [contextMenuNode, setContextMenuNode] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<{ id: string; name: string } | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
  const [wordImporting, setWordImporting] = useState(false);
  const [wordResult, setWordResult] = useState<any>(null);
  const [importBatch, setImportBatch] = useState<ImportBatch | null>(null);
  const [committingBatch, setCommittingBatch] = useState(false);
  const [wordSourceType, setWordSourceType] = useState<'lecture' | 'exam'>('lecture');
  const [selectedWordFile, setSelectedWordFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<ImportStep>(0);
  const [validationRows, setValidationRows] = useState<ImportValidationRow[]>([]);
  const [validationSummary, setValidationSummary] = useState<ImportValidationSummary>({ success: 0, warning: 0, failed: 0, total: 0 });
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [recentImportTasks, setRecentImportTasks] = useState<ImportTask[]>([]);
  const [importTaskDetail, setImportTaskDetail] = useState<(ImportTask & { items: ImportTaskItem[] }) | null>(null);
  const [importTaskDrawerOpen, setImportTaskDrawerOpen] = useState(false);
  const [examPapers, setExamPapers] = useState<any[]>([]);
  const [examForm] = Form.useForm();
  const [form] = Form.useForm();
  const examMetaRef = useRef<any>(null);

  const loadData = useCallback(async () => {
    try {
      const db = (window as any).dbService;
      let localQuestions: Question[] = [];
      if (db) {
        localQuestions = (db.getAllQuestions?.() || []).map(normalizeQuestion);
      }
      try {
        const res = await fetch(`${API_BASE}/questions?limit=200`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setQuestions(data.data.map(normalizeQuestion));
        } else {
          setQuestions(localQuestions);
        }
      } catch (_err) {
        setQuestions(localQuestions);
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
      setRecentImportTasks(db.getRecentImportTasks?.(8) || []);
    } catch (e) {
      console.error('QuestionBankImport loadData error:', e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadExamPapers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/exam-papers`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setExamPapers(data.data);
      }
    } catch (_err) {
      // fallback to empty array on error
    }
  }, []);

  useEffect(() => {
    if (wordSourceType === 'exam') {
      loadExamPapers();
    }
  }, [wordSourceType, loadExamPapers]);

  useEffect(() => {
    if (!contextMenuNode) return;
    const close = () => setContextMenuNode(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenuNode]);

  // Tree CRUD handlers
  const handleCreateKnowledgeNode = useCallback((name: string, parentId?: string | null) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.createKnowledgeNode({ name, parent_id: parentId || null });
    const kn = db.getKnowledgeTree?.() || [];
    setKnowledgeNodes([...kn]);
  }, []);

  const handleCreateModelNode = useCallback((name: string, parentId?: string | null) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.createModelNode?.({ name, parent_id: parentId || null });
    setModelNodes([...(db.getModelTree?.() || [])]);
  }, []);

  const handleRenameModelNode = useCallback((id: string, name: string) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.updateModelNode?.(id, { name });
    setModelNodes([...(db.getModelTree?.() || [])]);
  }, []);

  const handleDeleteModelNode = useCallback((id: string) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.deleteModelNode?.(id);
    setModelNodes([...(db.getModelTree?.() || [])]);
  }, []);

  const handleRenameKnowledgeNode = useCallback((id: string, name: string) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.updateKnowledgeNode(id, { name });
    const kn = db.getKnowledgeTree?.() || [];
    setKnowledgeNodes([...kn]);
  }, []);

  const handleDeleteKnowledgeNode = useCallback((id: string) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.deleteKnowledgeNode(id);
    const kn = db.getKnowledgeTree?.() || [];
    setKnowledgeNodes([...kn]);
  }, []);

  const handleTreeDrop = (info: any) => {
    const dragKey = info.dragNode.key as string;
    const dropKey = info.node.key as string;
    const dropToGap = info.dropToGap as boolean;
    const dropPosition = info.dropPosition as number;
    if (dragKey === dropKey) return;
    let newParentId: string | null;
    if (dropToGap) {
      const dropNode = knowledgeNodes.find(n => n.id === dropKey);
      newParentId = dropNode?.parent_id || null;
    } else {
      newParentId = dropKey;
    }
    const isDescendant = (nodeId: string, ancestorId: string): boolean => {
      const node = knowledgeNodes.find(n => n.id === nodeId);
      if (!node || !node.parent_id) return false;
      if (node.parent_id === ancestorId) return true;
      return isDescendant(node.parent_id, ancestorId);
    };
    if (isDescendant(dropKey, dragKey)) { message.warning('不能将知识点移动到其子节点下'); return; }
    const draggedNode = knowledgeNodes.find(n => n.id === dragKey);
    if (!draggedNode) return;
    const prevParentId = draggedNode.parent_id || null;
    const prevOrder = draggedNode.order;
    const db = (window as any).dbService;
    if (!db) return;
    const isSameLevel = dropToGap && draggedNode.parent_id === newParentId;
    if (isSameLevel) {
      const allNodes = db.getKnowledgeTree?.() || knowledgeNodes;
      const siblings = allNodes
        .filter((n: KnowledgeNode) => n.parent_id === newParentId || (!newParentId && !n.parent_id))
        .sort((a: KnowledgeNode, b: KnowledgeNode) => a.order - b.order);
      const dragIdx = siblings.findIndex((n: KnowledgeNode) => n.id === dragKey);
      let dropIdx = siblings.findIndex((n: KnowledgeNode) => n.id === dropKey);
      if (dragIdx >= 0 && dropIdx >= 0 && dragIdx !== dropIdx) {
        siblings.splice(dragIdx, 1);
        dropIdx = siblings.findIndex((n: KnowledgeNode) => n.id === dropKey);
        siblings.splice(dropPosition > 0 ? dropIdx + 1 : dropIdx, 0, draggedNode);
        siblings.forEach((n: KnowledgeNode, i: number) => db.updateKnowledgeNode(n.id, { order: i }));
      }
    } else { db.updateKnowledgeNode(dragKey, { parent_id: newParentId }); }
    setKnowledgeNodes((db.getKnowledgeTree?.() || []).map((n: any) => ({...n})));
    Modal.confirm({
      title: '确认移动', content: isSameLevel ? '确定调整该知识点的排序位置？' : '确定将选中知识点及其所有子节点移动到此位置？',
      okText: '移动', cancelText: '取消',
      onOk: () => { message.success(isSameLevel ? '顺序已调整' : '知识点已移动'); },
      onCancel: () => {
        if (isSameLevel) {
          const allNodes = db.getKnowledgeTree?.() || knowledgeNodes;
          const siblings = allNodes
            .filter((n: KnowledgeNode) => n.parent_id === prevParentId || (!prevParentId && !n.parent_id))
            .sort((a: KnowledgeNode, b: KnowledgeNode) => a.order - b.order);
          const dragIdx = siblings.findIndex((n: KnowledgeNode) => n.id === dragKey);
          if (dragIdx >= 0) {
            siblings.splice(dragIdx, 1);
            siblings.splice(Math.min(prevOrder, siblings.length), 0, draggedNode);
            siblings.forEach((n: KnowledgeNode, i: number) => db.updateKnowledgeNode(n.id, { order: i }));
          }
        } else { db.updateKnowledgeNode(dragKey, { parent_id: prevParentId }); }
        setKnowledgeNodes((db.getKnowledgeTree?.() || []).map((n: any) => ({...n})));
        message.info('已取消移动');
      },
    });
  };

  const treeData = buildTreeData(knowledgeNodes);
  const modelTreeData = buildTreeData(modelNodes);

  const nodeTitleRender = useCallback((nodeData: any) => {
    const nodeId = nodeData.key as string;
    const nodeName = nodeData.title as string;
    const isEditing = editingNodeId === nodeId;
    const isAdding = addingChildParentId === nodeId;
    return (
      <div style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, padding: '1px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {isEditing ? (
            <Input
              size="small" value={editingNodeName}
              onChange={e => setEditingNodeName(e.target.value)}
              onBlur={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.trim()) handleRenameKnowledgeNode(nodeId, v.trim());
                setEditingNodeId(null); setEditingNodeName('');
              }}
              onPressEnter={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.trim()) handleRenameKnowledgeNode(nodeId, v.trim());
                setEditingNodeId(null); setEditingNodeName('');
              }}
              style={{ width: 120 }} autoFocus onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              <span style={{ flex: 1, userSelect: 'none', fontSize: 13 }}>{nodeName}</span>
              <Tooltip title="添加子知识点">
                <Button type="link" size="small" icon={<PlusOutlined />}
                  onClick={e => { e.stopPropagation(); setAddingChildParentId(nodeId); setAddingChildName(''); }}
                  style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }} />
              </Tooltip>
              <Tooltip title="编辑知识点">
                <Button type="link" size="small" icon={<EditOutlined />}
                  onClick={e => { e.stopPropagation(); setEditingNodeId(nodeId); setEditingNodeName(nodeName); }}
                  style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }} />
              </Tooltip>
              <Tooltip title="删除知识点">
                <Button type="link" size="small" danger icon={<DeleteOutlined />}
                  onClick={e => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: '确认删除',
                      content: `确定删除知识点「${nodeName}」及其子知识点吗？`,
                      okText: '删除',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                      onOk: () => handleDeleteKnowledgeNode(nodeId),
                    });
                  }}
                  style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }} />
              </Tooltip>
            </>
          )}
        </div>
        {isAdding && (
          <div style={{ paddingLeft: 20, marginTop: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Input size="small" placeholder="子知识点名称" value={addingChildName}
                onChange={e => setAddingChildName(e.target.value)}
                onBlur={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (v.trim()) handleCreateKnowledgeNode(v.trim(), nodeId);
                  setAddingChildParentId(null); setAddingChildName('');
                }}
                onPressEnter={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (v.trim()) handleCreateKnowledgeNode(v.trim(), nodeId);
                  setAddingChildParentId(null); setAddingChildName('');
                }}
                style={{ width: 140 }} autoFocus onClick={e => e.stopPropagation()} />
              <Button type="link" size="small" icon={<CloseCircleOutlined />}
                onClick={e => { e.stopPropagation(); setAddingChildParentId(null); setAddingChildName(''); }}
                style={{ padding: 0, minWidth: 16, height: 16, fontSize: 11, color: '#999' }} />
            </div>
          </div>
        )}
      </div>
    );
  }, [editingNodeId, editingNodeName, addingChildParentId, addingChildName, handleRenameKnowledgeNode, handleCreateKnowledgeNode, handleDeleteKnowledgeNode]);

  const modelNodeTitleRender = useCallback((nodeData: any) => {
    const nodeId = nodeData.key as string;
    const nodeName = nodeData.title as string;
    const isEditing = editingNodeId === `model:${nodeId}`;
    const isAdding = addingChildParentId === `model:${nodeId}`;
    return (
      <div style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, padding: '1px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {isEditing ? (
            <Input
              size="small" value={editingNodeName}
              onChange={e => setEditingNodeName(e.target.value)}
              onBlur={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.trim()) handleRenameModelNode(nodeId, v.trim());
                setEditingNodeId(null); setEditingNodeName('');
              }}
              onPressEnter={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.trim()) handleRenameModelNode(nodeId, v.trim());
                setEditingNodeId(null); setEditingNodeName('');
              }}
              style={{ width: 120 }} autoFocus onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              <span style={{ flex: 1, userSelect: 'none', fontSize: 13 }}>{nodeName}</span>
              <Tooltip title="添加子模型">
                <Button type="link" size="small" icon={<PlusOutlined />}
                  onClick={e => { e.stopPropagation(); setAddingChildParentId(`model:${nodeId}`); setAddingChildName(''); }}
                  style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }} />
              </Tooltip>
              <Tooltip title="编辑模型">
                <Button type="link" size="small" icon={<EditOutlined />}
                  onClick={e => { e.stopPropagation(); setEditingNodeId(`model:${nodeId}`); setEditingNodeName(nodeName); }}
                  style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }} />
              </Tooltip>
              <Tooltip title="删除模型">
                <Button type="link" size="small" danger icon={<DeleteOutlined />}
                  onClick={e => { e.stopPropagation(); Modal.confirm({ title: '确认删除', content: `确定删除模型「${nodeName}」及其子模型吗？`, okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => handleDeleteModelNode(nodeId) }); }}
                  style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }} />
              </Tooltip>
            </>
          )}
        </div>
        {isAdding && (
          <div style={{ paddingLeft: 20, marginTop: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Input size="small" placeholder="子模型名称" value={addingChildName}
                onChange={e => setAddingChildName(e.target.value)}
                onBlur={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (v.trim()) handleCreateModelNode(v.trim(), nodeId);
                  setAddingChildParentId(null); setAddingChildName('');
                }}
                onPressEnter={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (v.trim()) handleCreateModelNode(v.trim(), nodeId);
                  setAddingChildParentId(null); setAddingChildName('');
                }}
                style={{ width: 140 }} autoFocus onClick={e => e.stopPropagation()} />
              <Button type="link" size="small" icon={<CloseCircleOutlined />}
                onClick={e => { e.stopPropagation(); setAddingChildParentId(null); setAddingChildName(''); }}
                style={{ padding: 0, minWidth: 16, height: 16, fontSize: 11, color: '#999' }} />
            </div>
          </div>
        )}
      </div>
    );
  }, [editingNodeId, editingNodeName, addingChildParentId, addingChildName, handleRenameModelNode, handleCreateModelNode, handleDeleteModelNode]);

  // Knowledge tree checkbox renderer in modal
  const renderKnowledgeCheckboxes = (nodes: KnowledgeNode[], parentId?: string, depth = 0) => {
    const children = nodes.filter(n => n.parent_id === parentId || (!parentId && !n.parent_id)).sort((a, b) => a.order - b.order);
    if (children.length === 0) return null;
    return (
      <div style={{ marginLeft: depth * 20 }}>
        {children.map(n => (
          <div key={n.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <Form.Item name={['knowledge_ids', n.id]} valuePropName="checked" noStyle>
                <Checkbox />
              </Form.Item>
              <span style={{ fontWeight: n.parent_id ? 'normal' : 600 }}>{n.name}</span>
            </div>
            {renderKnowledgeCheckboxes(nodes, n.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  const renderModelCheckboxes = (nodes: KnowledgeNode[], parentId?: string, depth = 0) => {
    const children = nodes.filter(n => n.parent_id === parentId || (!parentId && !n.parent_id)).sort((a, b) => a.order - b.order);
    if (children.length === 0) return null;
    return (
      <div style={{ marginLeft: depth * 20 }}>
        {children.map(n => (
          <div key={n.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <Form.Item name={['model_ids', n.id]} valuePropName="checked" noStyle>
                <Checkbox />
              </Form.Item>
              <span style={{ fontWeight: n.parent_id ? 'normal' : 600 }}>{n.name}</span>
            </div>
            {renderModelCheckboxes(nodes, n.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const db = (window as any).dbService;

    const knowledge_ids: string[] = [];
    if (values.knowledge_ids) {
      Object.entries(values.knowledge_ids).forEach(([id, checked]) => {
        if (checked) knowledge_ids.push(id);
      });
    }
    const model_ids: string[] = [];
    if (values.model_ids) {
      Object.entries(values.model_ids).forEach(([id, checked]) => {
        if (checked) model_ids.push(id);
      });
    }

    const data: any = {
      subject: values.subject,
      type: normalizeQuestionType(values.type),
      difficulty: values.difficulty,
      content: values.content,
      options: values.options ? values.options.split('\n').filter((s: string) => s.trim()) : [],
      answer: values.answer,
      analysis: values.analysis,
      knowledge_ids,
      knowledge_point: values.knowledge_point || '',
      model_ids,
      model_point: model_ids.length > 0 ? modelNodes.find(n => n.id === model_ids[0])?.name || '' : '',
      formulas: values.formulas ? values.formulas.split('\n').filter((s: string) => s.trim()) : [],
      tags: values.tags ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      source: values.source || '',
      year: values.year || '',
      grade: values.grade || '',
      semester: values.semester || '',
      exam_type: values.exam_type || '',
      status: editing?.status || 'draft',
      has_image: !!editing?.has_image,
      has_formula: !!editing?.has_formula,
      created_by: editing?.created_by || '',
    };

    if (editing) {
      db.updateQuestion(editing.id, data);
    } else {
      db.createQuestion(data);
    }
    setModalVisible(false);
    setEditing(null);
    form.resetFields();
    loadData();
    message.success('题目已保存');
  };

  const handleWordFileUpload = async (file: File, examMeta?: ExamMeta) => {
    // Store examMeta for later use in importWordResults
    examMetaRef.current = examMeta || null;
    setWordImporting(true);
    setWordResult(null);
    setValidationRows([]);
    setValidationSummary({ success: 0, warning: 0, failed: 0, total: 0 });
    setCommitResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source_type', wordSourceType);
      if (examMeta) {
        Object.entries(examMeta).forEach(([key, value]) => {
          if (value) formData.append(key, String(value));
        });
      }

      const res = await fetch(PARSE_WORD_ENDPOINT, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        message.error(data.error);
      } else {
        const taggedQuestions = (data.questions || []).map((q: any) => applyExamMetaToQuestion(q, examMeta || {}, wordSourceType));
        const nextResult = { ...data, questions: taggedQuestions, count: taggedQuestions.length };
        const validation = validateImportQuestions(taggedQuestions, questions);
        setWordResult(nextResult);
        setValidationRows(validation.rows);
        setValidationSummary(validation.summary);
        setImportStep(2);
        setImportBatch(null);
        const db = (window as any).dbService;
        try {
          const checkRes = await fetch(`${API_BASE}/imports/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_type: wordSourceType,
              file_name: file.name,
              items: taggedQuestions.map((q: any) => toServerQuestion(q, examMeta || {})),
            }),
          });
          const batchData = await checkRes.json();
          if (batchData.success) {
            const nextBatch = batchData.data || batchData;
            setImportBatch(nextBatch);
            const duplicateCount = Number(nextBatch.duplicate_items || nextBatch.quality_report?.duplicate_items || 0);
            if (duplicateCount > 0) {
              message.warning(`检测到 ${duplicateCount} 道完全重复试题，已自动过滤，提交导入时不会写入题库`);
            }
            if (db?.createImportTask) {
              db.createImportTask({
                id: nextBatch.id,
                source_type: wordSourceType,
                file_name: file.name,
                status: 'checked',
                total_items: taggedQuestions.length,
                success_items: validation.summary.success,
                warning_items: validation.summary.warning,
                failed_items: validation.summary.failed,
                duplicate_items: nextBatch.duplicate_items || 0,
                quality_report: nextBatch.quality_report || null,
                items: validation.rows.map(row => ({
                  item_index: row.index - 1,
                  status: row.status,
                  quality_score: row.status === 'success' ? 1 : row.status === 'warning' ? 0.7 : 0,
                  warnings: row.issues.filter(issue => issue.level === 'warning').map(issue => issue.message),
                  errors: row.issues.filter(issue => issue.level === 'failed').map(issue => issue.message),
                  payload: stripQuestionAssetPayload(row.question),
                })),
              });
              setRecentImportTasks(db.getRecentImportTasks?.(8) || []);
            }
          } else {
            message.warning(batchData.error || '导入批次校验未完成');
          }
        } catch (checkError: any) {
          message.warning('导入批次校验失败: ' + (checkError.message || 'unknown error'));
          if (db?.createImportTask) {
            db.createImportTask({
              source_type: wordSourceType,
              file_name: file.name,
              status: 'checked',
              total_items: taggedQuestions.length,
              success_items: validation.summary.success,
              warning_items: validation.summary.warning,
              failed_items: validation.summary.failed,
              duplicate_items: 0,
              items: validation.rows.map(row => ({
                item_index: row.index - 1,
                status: row.status,
                warnings: row.issues.filter(issue => issue.level === 'warning').map(issue => issue.message),
                errors: row.issues.filter(issue => issue.level === 'failed').map(issue => issue.message),
                payload: stripQuestionAssetPayload(row.question),
              })),
            });
            setRecentImportTasks(db.getRecentImportTasks?.(8) || []);
          }
        }
        message.success(`解析完成 ${taggedQuestions.length} 题，失败 ${validation.summary.failed} 题，警告 ${validation.summary.warning} 题`);
      }
    } catch (e: any) {
      message.error('导入失败: ' + (e.message || '网络请求失败'));
    }
    setWordImporting(false);
  };

  const handleSelectWordFile = (file: File) => {
    setSelectedWordFile(file);
    setWordResult(null);
    setImportBatch(null);
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
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) handleSelectWordFile(file);
    };
    input.click();
  };

  const handleStartParse = () => {
    if (!selectedWordFile) {
      message.warning('请先选择 Word 文件');
      return;
    }
    const meta = wordSourceType === 'exam' ? examForm.getFieldsValue() : undefined;
    handleWordFileUpload(selectedWordFile, meta);
  };

  const commitImportBatch = async () => {
    if (!importBatch) return;
    setCommittingBatch(true);
    try {
      const res = await fetch(`${API_BASE}/imports/${importBatch.id}/commit`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'commit failed');
      const nextBatch = data.data || data;
      const imported = Number(nextBatch.commit_result?.imported_items || nextBatch.accepted_items || 0);
      if (imported <= 0 && (wordResult?.questions || []).length > 0) {
        await importWordResults(wordResult, true);
        message.warning('服务端批次未写入题目，已自动改用本地题库导入');
        return;
      }
      setImportBatch(nextBatch);
      setWordResult(null);
      setImportStep(3);
      setCommitResult({
        id: nextBatch.id || importBatch.id,
        imported,
        failed: validationSummary.failed,
        warning: validationSummary.warning,
        created_at: new Date().toISOString(),
        source_type: wordSourceType,
        file_name: selectedWordFile?.name,
      });
      const db = (window as any).dbService;
      db?.updateImportTask?.(nextBatch.id || importBatch.id, {
        status: nextBatch.status || 'imported',
        result_summary: nextBatch.commit_result || null,
        success_items: imported,
        failed_items: nextBatch.commit_result?.failed_items || validationSummary.failed,
      });
      if ((wordResult?.questions || []).length > 0) {
        await importWordResults(wordResult, true);
      }
      setRecentImportTasks(db?.getRecentImportTasks?.(8) || []);
      loadData();
      message.success(`已入库 ${imported} 道题，索引任务已创建`);
    } catch (e: any) {
      message.error('提交导入批次失败: ' + (e.message || 'unknown error'));
    } finally {
      setCommittingBatch(false);
    }
  };

  const importWordResults = async (result: any, forceLocal = false) => {
    if (validationSummary.failed > 0) {
      message.warning('存在失败题目，请先处理或导出报告后再确认导入');
      return;
    }
    if (importBatch && !forceLocal) {
      commitImportBatch();
      return;
    }
    const db = (window as any).dbService;
    if (!db) { message.error('数据库未就绪'); return; }
    // Read stored examMeta for auto-labeling
    const meta = examMetaRef.current || {};
    let added = 0;
    let skippedDuplicates = 0;
    const exactStem = (value: unknown) => String(value || '')
      .replace(/<img\b[^>]*>/gi, '[image]')
      .replace(/&nbsp;/gi, ' ')
      .replace(/[−－]/g, '-')
      .replace(/[＋]/g, '+')
      .replace(/\s+/g, '')
      .trim();
    const existingStems = new Set((questions || []).map(q => exactStem(q.content || q.stem)).filter(Boolean));
    const seenStems = new Set<string>();
    for (const q of (result.questions || [])) {
      try {
        // Handle source_info from parser (lecture format annotations)
        if (q.source_info && wordSourceType === 'lecture') {
          const si = q.source_info;
          if (si.year && !q.year) q.year = si.year;
          if (si.exam_type && !q.exam_type) q.exam_type = si.exam_type;
          if (si.paper_name && !q.paper_name) q.paper_name = si.paper_name;
          if (si.region && !q.region) q.region = si.region;
          if (si.source && !q.source) q.source = si.source;
        }
        const rawStem = getQuestionStem(q);
        const stemKey = exactStem(rawStem);
        if (stemKey && (existingStems.has(stemKey) || seenStems.has(stemKey))) {
          skippedDuplicates++;
          continue;
        }
        if (stemKey) seenStems.add(stemKey);
        const knowledge_ids = normalizeImportedKnowledgeIds(db, q);
        const model_ids = [...new Set([...(q.model_ids || []), ...(q.model_point_ids || [])])];
        const preparedQuestion = await prepareQuestionAssetsForStorage({
          subject: q.subject || '\u7269\u7406',
          type: questionTypeFromParser(q.question_types),
          difficulty: 3,
          content: rawStem,
          stem: rawStem,
          options: (q.options || []).map((o: any) => `${o.label}. ${o.content}`),
          answer: q.answer || '',
          analysis: q.analysis || '',
          source: q.source || '',
          year: toSchoolYear(q.year || meta.year || ''),
          grade: q.grade || meta.grade || '',
          semester: q.semester || meta.semester || '',
          exam_type: q.exam_type || meta.exam_type || '其他',
          region: q.region || meta.region || '',
          school: q.school || meta.school || '',
          alliance: q.alliance || meta.alliance || '',
          paper_name: q.paper_name || meta.paper_name || '',
          paper_id: q.paper_id || meta.paper_id || '',
          question_number: q.question_number || q.number || null,
          edit_status: '\u672a\u7f16\u8f91',
          status: q.status || 'draft',
          has_image: !!q.has_image,
          has_formula: !!q.has_formula,
          created_by: q.created_by || '',
          tags: [],
          formulas: q.formulas || [],
          assets: q.assets || [],
          knowledge_point: q.knowledge_point || '',
          knowledge_ids,
          model_point: q.model_point || '',
          model_ids,
        });
        db.createQuestion(preparedQuestion);
        added++;
      } catch (e) { /* skip bad ones */ }
    }
    if (skippedDuplicates > 0) {
      message.warning(`检测到 ${skippedDuplicates} 道完全重复试题，已自动过滤`);
    }
    setWordResult(null);
    setImportStep(3);
    setCommitResult({
      id: `local-${Date.now()}`,
      imported: added,
      failed: validationSummary.failed,
      warning: validationSummary.warning,
      created_at: new Date().toISOString(),
      source_type: wordSourceType,
      file_name: selectedWordFile?.name,
    });
    const dbTask = db?.createImportTask?.({
      source_type: wordSourceType,
      file_name: selectedWordFile?.name,
      status: 'imported',
      total_items: result.count || added,
      success_items: added,
      warning_items: validationSummary.warning,
      failed_items: validationSummary.failed,
      duplicate_items: skippedDuplicates,
      result_summary: { imported_items: added, failed_items: validationSummary.failed },
      items: validationRows.map(row => ({
        item_index: row.index - 1,
        status: row.status === 'failed' ? 'failed' : 'imported',
        warnings: row.issues.filter(issue => issue.level === 'warning').map(issue => issue.message),
        errors: row.issues.filter(issue => issue.level === 'failed').map(issue => issue.message),
        payload: stripQuestionAssetPayload(row.question),
      })),
    });
    if (dbTask) setRecentImportTasks(db.getRecentImportTasks?.(8) || []);
    await reconcileQuestionLocalStore((db.getAllQuestions?.() || []).map(normalizeQuestion));
    loadData();
    message.success(`成功导入 ${added}/${result.count} 道题目到本地题库`);
  };

  const openImportTaskDetail = async (task: ImportTask) => {
    const db = (window as any).dbService;
    let detail = db?.getImportTaskDetail?.(task.id) || null;
    if (!detail) {
      try {
        const res = await fetch(`${API_BASE}/imports/${task.id}`);
        const data = await res.json();
        if (data.success && data.data) {
          detail = {
            ...task,
            ...data.data,
            items: (data.data.items || []).map((item: any) => ({
              id: item.id,
              task_id: item.task_id || item.batch_id || task.id,
              item_index: item.item_index || 0,
              question_id: item.question_id || '',
              content_hash: item.content_hash || '',
              status: item.status || 'pending',
              quality_score: Number(item.quality_score || 0),
              warnings: Array.isArray(item.warnings) ? item.warnings : [],
              errors: Array.isArray(item.errors) ? item.errors : [],
              error_message: item.error_message || '',
              payload: item.payload || null,
              created_at: item.created_at || data.data.created_at,
              updated_at: item.updated_at || data.data.updated_at,
            })),
          };
        }
      } catch (_err) {}
    }
    setImportTaskDetail(detail || { ...task, items: [] });
    setImportTaskDrawerOpen(true);
  };

  return (
    <Row gutter={16}>
      {/* Knowledge Tree Sidebar */}
      {treeVisible && (
        <Col span={5}>
          <Card
            size="small"
            title={<span><BranchesOutlined /> 知识树</span>}
            extra={<Button type="link" size="small" onClick={() => setTreeVisible(false)}>收起</Button>}
            style={{ height: '100%' }}
          >
            <div className="qb-tree-section-title qb-knowledge-tree-title"><BranchesOutlined /> 知识点</div>
            {/* Root-level inline add */}
            {addingChildParentId === '__ROOT__' ? (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Input size="small" placeholder="根节点名称" value={addingChildName}
                  onChange={e => setAddingChildName(e.target.value)}
                  onBlur={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v.trim()) handleCreateKnowledgeNode(v.trim(), null);
                    setAddingChildParentId(null); setAddingChildName('');
                  }}
                  onPressEnter={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v.trim()) handleCreateKnowledgeNode(v.trim(), null);
                    setAddingChildParentId(null); setAddingChildName('');
                  }}
                  style={{ flex: 1 }} autoFocus />
                <Button type="link" size="small" icon={<CloseCircleOutlined />}
                  onClick={() => { setAddingChildParentId(null); setAddingChildName(''); }}
                  style={{ padding: 0, minWidth: 16, height: 16, color: '#999' }} />
              </div>
            ) : (
              <Button type="dashed" size="small" icon={<PlusOutlined />}
                onClick={() => { setAddingChildParentId('__ROOT__'); setAddingChildName(''); }}
                style={{ marginBottom: 8, width: '100%' }}>新建根节点</Button>
            )}

            {/* Right-click context menu */}
            {contextMenuNode && (
              <div style={{
                position: 'fixed', left: Math.min(contextMenuNode.x, window.innerWidth - 160),
                top: Math.min(contextMenuNode.y, window.innerHeight - 160),
                zIndex: 1050, background: '#fff', borderRadius: 6,
                boxShadow: '0 3px 12px rgba(0,0,0,0.15)', padding: '4px 0',
                minWidth: 150, border: '1px solid #e8e8e8',
              }}>
                <div style={{ padding: '6px 12px', color: '#666', fontSize: 12, borderBottom: '1px solid #f0f0f0' }}>
                  <FolderOpenOutlined style={{ marginRight: 6 }} />{contextMenuNode.name}
                </div>
                <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => { setAddingChildParentId(contextMenuNode.id); setAddingChildName(''); setContextMenuNode(null); }}>
                  <PlusOutlined /> 添加子知识点
                </div>
                <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => { setEditingNodeId(contextMenuNode.id); setEditingNodeName(contextMenuNode.name); setContextMenuNode(null); }}>
                  <EditOutlined /> 重命名
                </div>
                <div style={{ borderTop: '1px solid #f0f0f0', margin: '4px 0' }} />
                <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}
                  onClick={() => { setDeleteConfirmNode({ id: contextMenuNode.id, name: contextMenuNode.name }); setContextMenuNode(null); }}>
                  <DeleteOutlined /> 删除知识点
                </div>
              </div>
            )}

            {/* Delete confirmation modal */}
            <Modal
              open={!!deleteConfirmNode} title="确认删除"
              onCancel={() => setDeleteConfirmNode(null)}
              onOk={() => {
                if (deleteConfirmNode) {
                  handleDeleteKnowledgeNode(deleteConfirmNode.id);
                  message.success(`已删除知识点「${deleteConfirmNode.name}」及其所有子节点，关联题目已同步清理`);
                  setDeleteConfirmNode(null);
                }
              }}
              okText="确定删除" cancelText="取消"
              okButtonProps={{ danger: true }} width={420}
            >
              {deleteConfirmNode && (
                <div>
                  <p style={{ fontSize: 14, marginBottom: 8 }}>
                    确定要删除知识点 <Tag color="red">{deleteConfirmNode.name}</Tag> 吗？
                  </p>
                  <p style={{ color: '#ff4d4f', fontSize: 13 }}>
                    <DeleteOutlined /> 此操作将同时删除该知识点下的所有次级知识点，不可恢复。
                  </p>
                </div>
              )}
            </Modal>
            <div className="knowledge-tree">
            <Tree
              treeData={treeData} titleRender={nodeTitleRender}
              draggable onDrop={handleTreeDrop}
              showIcon={false}
              showLine={{ showLeafIcon: false }}
              blockNode allowDrop={() => true}
              onRightClick={({ event, node }: any) => {
                event.preventDefault();
                const targetNode = knowledgeNodes.find(n => n.id === node.key);
                if (targetNode) {
                  setContextMenuNode({ id: targetNode.id, name: targetNode.name, x: event.clientX, y: event.clientY });
                }
              }}
              style={{ fontSize: 13 }} />
            </div>

            <div className="qb-tree-section-title qb-model-tree-title"><BranchesOutlined /> 模型</div>
            {addingChildParentId === 'model:__ROOT__' ? (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Input size="small" placeholder="根模型名称" value={addingChildName}
                  onChange={e => setAddingChildName(e.target.value)}
                  onBlur={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v.trim()) handleCreateModelNode(v.trim(), null);
                    setAddingChildParentId(null); setAddingChildName('');
                  }}
                  onPressEnter={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v.trim()) handleCreateModelNode(v.trim(), null);
                    setAddingChildParentId(null); setAddingChildName('');
                  }}
                  style={{ flex: 1 }} autoFocus />
                <Button type="link" size="small" icon={<CloseCircleOutlined />}
                  onClick={() => { setAddingChildParentId(null); setAddingChildName(''); }}
                  style={{ padding: 0, minWidth: 16, height: 16, color: '#999' }} />
              </div>
            ) : (
              <Button type="dashed" size="small" icon={<PlusOutlined />}
                onClick={() => { setAddingChildParentId('model:__ROOT__'); setAddingChildName(''); }}
                style={{ marginBottom: 8, width: '100%' }}>新建根模型</Button>
            )}
            <div className="knowledge-tree">
              <Tree
                treeData={modelTreeData}
                titleRender={modelNodeTitleRender}
                showIcon={false}
                showLine={{ showLeafIcon: false }}
                blockNode
                draggable={false}
                style={{ fontSize: 13 }}
              />
            </div>
          </Card>
        </Col>
      )}
      {/* Main Content */}
      <Col span={treeVisible ? 19 : 24}>
        <Card style={{ margin: 0 }}>
          {!treeVisible && (
            <div style={{ marginBottom: 12 }}>
              <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开知识点/模型</Button>
            </div>
          )}

          <Steps
            current={importStep}
            style={{ marginBottom: 20 }}
            items={[
              { title: '上传文件' },
              { title: '选择类型' },
              { title: '预校验' },
              { title: '确认导入' },
            ]}
          />

          <div style={{ background: '#f7f9fc', border: '1px solid #e8edf3', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <Row gutter={[20, 16]} align="top">
              <Col xs={24} lg={9}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileWordOutlined style={{ fontSize: 22, color: '#1890ff' }} />
                    <Text strong>导入格式与说明</Text>
                  </div>
                  <Radio.Group
                    value={wordSourceType}
                    onChange={e => {
                      setWordSourceType(e.target.value);
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
                  </Radio.Group>
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#666', lineHeight: 1.8 }}>
                    <li><b>讲义格式</b>：适合按专题、题号、题干、选项和批注答案解析整理的讲义文件。</li>
                    <li><b>试卷格式</b>：适合整卷导入，选择文件后会尝试从文件名补全年份、考试类型、年级、学期、地区、学校和试卷名。</li>
                    <li>选择文件只会读取文件名信息，点击开始解析后才会上传并解析内容。</li>
                  </ul>
                  {selectedWordFile && (
                    <Tag color="blue" style={{ whiteSpace: 'normal', lineHeight: 1.6 }}>
                      已选择：{selectedWordFile.name}
                    </Tag>
                  )}
                </Space>
              </Col>
              <Col xs={24} lg={15}>
                <Form form={examForm} layout="vertical" disabled={wordSourceType !== 'exam'} initialValues={{ year: toSchoolYear(new Date().getFullYear().toString()) }}>
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
            <p style={{ color: '#999' }}>支持 .doc / .docx，当前模式：{wordSourceType === 'lecture' ? '讲义格式' : '试卷格式'}</p>
            <Space>
              <Button size="large" icon={<FileWordOutlined />} onClick={openWordFilePicker}>
                选择文件
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                loading={wordImporting}
                disabled={!selectedWordFile || !wordSourceType}
                onClick={handleStartParse}
              >
                开始解析
              </Button>
            </Space>
          </div>

          {(validationRows.length > 0 || commitResult) && (
            <div style={{ marginTop: 16 }}>
              <Divider orientation="left">预校验与确认导入</Divider>
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
                  <Table
                    size="small"
                    rowKey="key"
                    dataSource={validationRows}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: '序号', dataIndex: 'index', width: 70 },
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
                    ]}
                  />
                  <Space style={{ marginTop: 12 }}>
                    <Button icon={<DownloadOutlined />} onClick={() => downloadImportValidationReport(validationRows)}>导出错误报告</Button>
                    <Button type="primary" loading={committingBatch} disabled={!wordResult || validationSummary.failed > 0} onClick={() => wordResult && importWordResults(wordResult)}>
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
                  message={`导入完成：成功 ${commitResult.imported} 题，警告 ${commitResult.warning} 题，失败 ${commitResult.failed} 题`}
                  description={commitResult.file_name ? `文件：${commitResult.file_name}` : undefined}
                />
              )}
            </div>
          )}

          {/* 最近导入记录 */}
          {(recentImportTasks.length > 0 || questions.length > 0) && (
            <div style={{ marginTop: 16 }}>
              <Divider orientation="left">最近导入</Divider>
              {recentImportTasks.length > 0 ? (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={recentImportTasks}
                  pagination={false}
                  columns={[
                    { title: '文件', dataIndex: 'file_name', render: (v: string) => v || '-' },
                    { title: '类型', dataIndex: 'source_type', width: 90, render: (v: string) => v === 'exam' ? '试卷' : '讲义' },
                    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusColor(v)}>{importTaskStatusText(v)}</Tag> },
                    { title: '总数', dataIndex: 'total_items', width: 70 },
                    { title: '警告', dataIndex: 'warning_items', width: 70 },
                    { title: '失败', dataIndex: 'failed_items', width: 70 },
                    { title: '时间', dataIndex: 'created_at', width: 170, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
                    { title: '操作', width: 80, render: (_: any, record: ImportTask) => <Button type="link" onClick={() => openImportTaskDetail(record)}>详情</Button> },
                  ]}
                />
              ) : (
                <div style={{ color: '#666', fontSize: 13 }}>
                  题库中共有 <b>{questions.length}</b> 道题目，来自多次导入操作。
                </div>
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
                { title: '序号', dataIndex: 'item_index', width: 70, render: (v: number) => Number(v || 0) + 1 },
                { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag> },
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
        title={editing ? '编辑题目' : '添加题目'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => { setModalVisible(false); setEditing(null); form.resetFields(); }}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
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
              <Form.Item name="difficulty" label="难度" rules={[{ required: true }]}>
                <Select>{[1,2,3,4,5].map(d => <Select.Option key={d} value={d}>{'★'.repeat(d)}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="content" label="题目内容" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder={'支持公式（用 $$ 包裹），如 $$F=ma$$\n物理量用斜体 <i>F</i>、单位正体 m/s、数学常数正体 π\n下标属性用 \\mathrm：$$v_{\\mathrm{0}}$$\n向量用 \\boldsymbol：$$\\boldsymbol{F}$$'} />
          </Form.Item>
          <details style={{ marginBottom: 12, fontSize: 12, color: '#666', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, padding: '6px 10px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>物理学科正斜体规范</summary>
            <div style={{ marginTop: 4, lineHeight: 1.8 }}>
              <b>斜体</b>：物理量符号（<i>F</i>, <i>m</i>, <i>v</i>, <i>g</i>, <i>E</i>, <i>B</i>）、变量下标（<i>m<sub>i</sub></i>）<br/>
              <b>正体</b>：单位（m, s, kg, N, A）、数学常数（π, e）、函数（sin, cos, log）、微分符号 d、化学元素下标（<i>m</i><sub>H</sub>）<br/>
              <b>粗斜体</b>：向量（<b><i>F</i></b>, <b><i>v</i></b>）
            </div>
          </details>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.content !== cur.content}>
            {({ getFieldValue }) => {
              const content = getFieldValue('content');
              if (!content) return null;
              return (
                <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 6, border: '1px solid #e8e8e8' }}>
                  <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>预览：</div>
                  <QuestionRenderer content={content} />
                </div>
              );
            }}
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="options" label="选项（每行一个）">
                <TextArea rows={3} placeholder="A. xxx&#10;B. xxx&#10;C. xxx&#10;D. xxx" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="answer" label="答案" rules={[{ required: true }]}>
                <Input placeholder="正确答案" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="analysis" label="解析">
            <TextArea rows={2} placeholder="解题思路（可选）" />
          </Form.Item>

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

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="formulas" label="公式（每行一个）">
                <TextArea rows={2} placeholder="F=ma&#10;E=mc²" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tags" label="标签（逗号分隔）">
                <Input placeholder="高考、压轴题、易错" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="关联知识点">
            <div style={{ maxHeight: 200, overflow: 'auto', background: '#fafafa', padding: 12, borderRadius: 6 }}>
              {knowledgeNodes.length > 0 ? renderKnowledgeCheckboxes(knowledgeNodes) : <Empty description="暂无知识点数据" />}
            </div>
          </Form.Item>
          <Form.Item label="关联模型">
            <div style={{ maxHeight: 200, overflow: 'auto', background: '#fafafa', padding: 12, borderRadius: 6 }}>
              {modelNodes.length > 0 ? renderModelCheckboxes(modelNodes) : <Empty description="暂无模型数据" />}
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
};

export default QuestionBankImport;
