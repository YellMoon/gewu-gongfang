import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Modal, Form, Input, Select as AntSelect, Space, Tag, message,
  Popconfirm, Tooltip, Tree, Divider, Badge, Checkbox, Dropdown, Menu, Empty, Row, Col, Typography, Drawer,
  Pagination, InputNumber
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, CopyOutlined,
  FolderOpenOutlined, TagsOutlined, AimOutlined, BranchesOutlined,
  CheckCircleOutlined, FileWordOutlined, CloseCircleOutlined, EyeOutlined,
  FilterOutlined, ReloadOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode, QuestionVersion } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType } from '../constants/questionTypes';
import { splitSearchTerms } from '../utils/highlightText';
import { toggleQuestionBasket, useQuestionBasketIds } from '../components/QuestionBasket';
import QuestionPreviewCard from '../components/QuestionPreviewCard';
import QuestionRenderer, { createKaTeXPhysicsOptions } from '../components/QuestionRenderer';
import katex from 'katex';
import { applyPhysicsNotationToHTML } from '../utils/physicsNotation';
import './QuestionBankPreview.css';

const { TextArea } = Input;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;
const API_BASE = getApiBase('/api/question-bank');
const QUESTION_PAGE_SIZE = 10;
const KATEX_EXPORT_CSS = `
.katex{font:normal 1.21em "KaTeX_Main","Times New Roman",serif;line-height:1.2;text-rendering:auto}
.katex .base{position:relative;white-space:nowrap;width:min-content;display:inline-block}
.katex .strut,.katex .mspace{display:inline-block}
.katex .vlist-t{border-collapse:collapse;display:inline-table;table-layout:fixed}
.katex .vlist-r{display:table-row}
.katex .vlist{display:table-cell;position:relative;vertical-align:bottom}
.katex .vlist>span{display:block;height:0;position:relative}
.katex .vlist>span>span{display:inline-block}
.katex .mfrac>span>span{text-align:center}
.katex .mfrac .frac-line{border-bottom-style:solid;display:inline-block;width:100%;min-height:1px}
.katex .sqrt>.root{margin-left:.2777777778em;margin-right:-.5555555556em}
.katex .mathit,.katex .mathnormal{font-family:"KaTeX_Math","Times New Roman",serif;font-style:italic}
.katex .mathrm,.katex .mainrm{font-family:"KaTeX_Main","Times New Roman",serif;font-style:normal}
`;

function renderContentForExport(content: string): string {
  if (!content) return '';
  const re = /\$\$([\s\S]*?)\$\$/g;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      result += applyPhysicsNotationToHTML(content.slice(last, m.index));
    }
    try {
      const rendered = katex.renderToString(m[1], createKaTeXPhysicsOptions(true));
      result += `<div class="katex-display">${rendered}</div>`;
    } catch {
      result += `<div class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">${m[1]}</span></span></span></span></div>`;
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    result += applyPhysicsNotationToHTML(content.slice(last));
  }
  return result;
}

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试', '竞赛', '强基计划', '其他'];
const GRADES = ['高一', '高二', '高三'];
const LIMIT_GRADES = ['全部', ...GRADES];
const LIMIT_SEMESTERS = ['全部', '上学期', '下学期'];
const LIMIT_TYPES = ['全部', ...QUESTION_TYPES];
const SEMESTERS = ['上学期', '下学期'];
const LIMIT_EXAM_TYPES = ['全部', ...EXAM_TYPES];
const LIMIT_DIFFICULTIES = [
  { label: '全部', value: '全部' },
  { label: '简单', value: '简单' },
  { label: '中等', value: '中等' },
  { label: '较难', value: '较难' },
];
const LIMIT_STATUSES = [
  { label: '全部', value: '全部' },
  { label: '草稿', value: 'draft' },
  { label: '待审核', value: 'pending' },
  { label: '已发布', value: 'published' },
  { label: '已下线', value: 'offline' },
  { label: '已废弃', value: 'deprecated' },
];

const YEAR_OPTIONS = Array.from({ length: 18 }, (_, i) => {
  const start = 2026 - i;
  const end = start + 1;
  return { label: `${start}-${end}学年`, value: `${start}-${end}` };
});

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

function filterTreeDataByText(treeData: any[], keyword: string): any[] {
  const term = keyword.trim().toLowerCase();
  if (!term) return treeData;
  return treeData
    .map(node => {
      const children = filterTreeDataByText(node.children || [], term);
      const matched = String(node.title || '').toLowerCase().includes(term);
      return matched || children.length > 0 ? { ...node, children } : null;
    })
    .filter(Boolean);
}

const QuestionBankPreview: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);

  // Multi-select filter state
  const [filterSubjects, setFilterSubjects] = useState<string[]>(['物理']);
  const [filterTypes, setFilterTypes] = useState<string[]>(['全部']); // default: 全部
  const [filterExamTypes, setFilterExamTypes] = useState<string[]>(['全部']); // default: 全部
  const [filterGrades, setFilterGrades] = useState<string[]>(['全部']); // default: 全部
  const [filterSemesters, setFilterSemesters] = useState<string[]>(['全部']); // default: 全部
  const [filterYear, setFilterYear] = useState<string>('全部');
  const [filterDifficulties, setFilterDifficulties] = useState<string[]>(['全部']);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(['全部']);
  const [basketOnly, setBasketOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [treeSearchText, setTreeSearchText] = useState('');

  // 排除知识点
  const [filterExcludeKnowledgeIds, setFilterExcludeKnowledgeIds] = useState<(string | undefined)[]>([undefined]);
  const [modelSelectedIds, setModelSelectedIds] = useState<(string | undefined)[]>([undefined]);

  // 获取某节点及其所有后代 ID
  const getDescendantIds = (nodes: KnowledgeNode[], parentId: string): string[] => {
    const result: string[] = [parentId];
    const children = nodes.filter(n => n.parent_id === parentId);
    for (const child of children) {
      result.push(...getDescendantIds(nodes, child.id));
    }
    return result;
  };

  const [searchText, setSearchText] = useState<string>('');
  const [appliedSearchText, setAppliedSearchText] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [basketIds] = useQuestionBasketIds();
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [treeVisible, setTreeVisible] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [questionZoom, setQuestionZoom] = useState(1);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeName, setEditingNodeName] = useState('');
  const [addingChildParentId, setAddingChildParentId] = useState<string | null | '__ROOT__'>(null);
  const [addingChildName, setAddingChildName] = useState('');
  const [contextMenuNode, setContextMenuNode] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<{ id: string; name: string } | null>(null);
  const [form] = Form.useForm();

  // Knowledge multi-select search state
  const [knowledgeSelectedIds, setKnowledgeSelectedIds] = useState<(string | undefined)[]>([undefined]);

  const dbService = (window as any).dbService;

  const normalizeQuestion = (row: any): Question => ({
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    content: row.content ?? row.stem ?? '',
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
  } as Question);

  const loadData = useCallback(async () => {
    try {
      const db = (window as any).dbService;
      let localQuestions: Question[] = [];
      if (db) {
        localQuestions = (db.getAllQuestions?.() || []).map(normalizeQuestion);
        setQuestions(localQuestions);
        const kn = db.getKnowledgeTree?.() || [];
        setKnowledgeNodes(kn);
        const models = db.getModelTree?.() || [];
        setModelNodes(models);
        if (models.length === 0) {
          db.initDefaultModelTree?.();
          setModelNodes(db.getModelTree?.() || []);
        }
      }
      try {
        const res = await fetch(`${API_BASE}/questions?limit=200`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const merged = new Map<string, Question>();
          for (const question of localQuestions) merged.set(question.id, question);
          for (const question of data.data.map(normalizeQuestion)) merged.set(question.id, question);
          setQuestions([...merged.values()]);
        } else {
          setQuestions(localQuestions);
        }
      } catch (_err) {
        setQuestions(localQuestions);
      }
    } catch (e) {
      console.error('QuestionBankPreview loadData error:', e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!contextMenuNode) return;
    const close = () => setContextMenuNode(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenuNode]);

  const activeKnowledgeIds = knowledgeSelectedIds.filter((id): id is string => !!id);
  const activeModelIds = modelSelectedIds.filter((id): id is string => !!id);
  const activeExcludeKnowledgeIds = filterExcludeKnowledgeIds.filter((id): id is string => !!id);
  const searchTerms = splitSearchTerms(appliedSearchText);
  const normalizeCheckGroup = (vals: any[]): string[] => {
    if (vals.includes('全部') && vals.length > 1) {
      return vals.filter(v => v !== '全部') as string[];
    }
    return vals.length === 0 ? ['全部'] : vals as string[];
  };
  const singleValue = (values: string[]) => values.find(value => value !== '全部') || '全部';
  const setSingleValue = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setter([value || '全部']);
  };
  const difficultyBucket = (difficulty?: number) => {
    const value = Number(difficulty || 1);
    if (value <= 2) return '简单';
    if (value === 3) return '中等';
    return '较难';
  };
  const resetFilters = () => {
    setFilterTypes(['全部']);
    setFilterExamTypes(['全部']);
    setFilterGrades(['全部']);
    setFilterSemesters(['全部']);
    setFilterYear('全部');
    setFilterDifficulties(['全部']);
    setFilterStatuses(['全部']);
    setBasketOnly(false);
    setSourceFilter('');
    setKnowledgeSelectedIds([undefined]);
    setFilterExcludeKnowledgeIds([undefined]);
    setModelSelectedIds([undefined]);
    setSearchText('');
    setAppliedSearchText('');
  };

  // 将知识点 ID 展开为所有底层后代（用于筛选）
  const expandedIncludeGroups = activeKnowledgeIds
    .filter(id => !!id)
    .map(id => getDescendantIds(knowledgeNodes, id));
  const expandedExcludeIds = filterExcludeKnowledgeIds
    .filter((id): id is string => !!id)
    .flatMap(id => getDescendantIds(knowledgeNodes, id));
  const expandedModelGroups = activeModelIds
    .filter(id => !!id)
    .map(id => getDescendantIds(modelNodes, id));

  const getNodeName = (id: string) => {
    const n = knowledgeNodes.find(x => x.id === id);
    return n ? n.name : id;
  };

  const getModelName = (id: string) => {
    const n = modelNodes.find(x => x.id === id);
    return n ? n.name : id;
  };

  // Filters
  const filtered = questions.filter(q => {
    const row = q as Question & { subject_id?: string };
    if (filterSubjects.length > 0 && !filterSubjects.includes(row.subject || row.subject_id || '')) return false;
    if (!filterTypes.includes('全部') && filterTypes.length > 0 && !filterTypes.includes(normalizeQuestionType(q.type))) return false;
    if (!filterExamTypes.includes('全部') && filterExamTypes.length > 0 && !filterExamTypes.includes(q.exam_type || '其他')) return false;
    if (!filterStatuses.includes('全部') && filterStatuses.length > 0 && !filterStatuses.includes(q.status || 'draft')) return false;
    if (!filterGrades.includes('全部') && filterGrades.length > 0 && !filterGrades.includes(q.grade || '')) return false;
    if (!filterSemesters.includes('全部') && filterSemesters.length > 0 && !filterSemesters.includes(q.semester || '')) return false;
    if (!filterDifficulties.includes('全部') && filterDifficulties.length > 0 && !filterDifficulties.includes(difficultyBucket(q.difficulty))) return false;
    if (filterYear && filterYear !== '全部' && q.year !== filterYear) return false;
    if (basketOnly && !basketIds.includes(q.id)) return false;
    if (sourceFilter.trim()) {
      const sourceHaystack = [q.source, q.region, q.school, q.exam_type, q.year].filter(Boolean).join(' ').toLowerCase();
      if (!sourceHaystack.includes(sourceFilter.trim().toLowerCase())) return false;
    }
    if (searchTerms.length > 0) {
      const knowledgeNames = (q.knowledge_ids || []).map(getNodeName).join(' ');
      const modelNames = (q.model_ids || []).map(getModelName).join(' ');
      const haystack = [
        q.content,
        q.answer,
        q.analysis,
        knowledgeNames,
        modelNames,
        q.source,
        q.exam_type,
        q.region,
        q.school,
        q.year,
      ].join('\n').toLowerCase();
      if (!searchTerms.every(term => haystack.includes(term.toLowerCase()))) return false;
    }
    const qKnowledgeIds = q.knowledge_ids || [];
    // 知识点 AND 逻辑（展开为后代）
    if (expandedIncludeGroups.length > 0) {
      if (!expandedIncludeGroups.every(group => group.some(kid => qKnowledgeIds.includes(kid)))) return false;
    }
    // 排除知识点（展开为后代，任一匹配则排除）
    if (expandedExcludeIds.length > 0) {
      if (expandedExcludeIds.some(kid => qKnowledgeIds.includes(kid))) return false;
    }
    const qModelIds = q.model_ids || [];
    if (expandedModelGroups.length > 0) {
      if (!expandedModelGroups.every(group => group.some(mid => qModelIds.includes(mid)))) return false;
    }
    return true;
  }).sort((a, b) => (b.created_at || b.updated_at || '').localeCompare(a.created_at || a.updated_at || ''));
  const dedupedFiltered = filtered.reduce<Question[]>((rows, question) => {
    const fingerprint = String(question.content || question.stem || '').replace(/\s+/g, '');
    const existingIndex = rows.findIndex(item => String(item.content || item.stem || '').replace(/\s+/g, '') === fingerprint && fingerprint);
    if (existingIndex === -1) return [...rows, question];
    const existing = rows[existingIndex] as any;
    const current = question as any;
    const existingRich = (existing.assets || []).length + (existing.formulas || []).length;
    const currentRich = (current.assets || []).length + (current.formulas || []).length;
    if (currentRich > existingRich) {
      const next = [...rows];
      next[existingIndex] = question;
      return next;
    }
    return rows;
  }, []);
  const totalPages = Math.max(1, Math.ceil(dedupedFiltered.length / QUESTION_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleFiltered = dedupedFiltered.slice((safeCurrentPage - 1) * QUESTION_PAGE_SIZE, safeCurrentPage * QUESTION_PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedSearchText, filterSubjects, filterTypes, filterExamTypes, filterGrades, filterSemesters, filterYear, filterDifficulties, filterStatuses, basketOnly, sourceFilter, activeKnowledgeIds.join(','), activeModelIds.join(','), expandedExcludeIds.join(',')]);

  const handleCreateKnowledgeNode = useCallback((name: string, parentId?: string | null) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.createKnowledgeNode({ name, parent_id: parentId || null });
    const kn = db.getKnowledgeTree?.() || [];
    setKnowledgeNodes([...kn]);
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
    } else { newParentId = dropKey; }
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

  const currentSubject = filterSubjects[0] || '物理';
  const subjectKnowledgeNodes = knowledgeNodes.filter((node: any) => !node.subject || filterSubjects.includes(node.subject));
  const subjectModelNodes = modelNodes.filter((node: any) => !node.subject || filterSubjects.includes(node.subject));
  const treeData = buildTreeData(subjectKnowledgeNodes);
  const modelTreeData = buildTreeData(subjectModelNodes);
  const visibleTreeData = filterTreeDataByText(treeData, treeSearchText);
  const visibleModelTreeData = filterTreeDataByText(modelTreeData, treeSearchText);

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
      exam_type: values.exam_type || '其他',
      region: values.region || '',
      school: values.school || '',
      edit_status: '已编辑',
      status: editing?.status || 'draft',
      has_image: !!editing?.has_image,
      has_formula: !!editing?.has_formula,
      created_by: editing?.created_by || '',
    };

    if (editing) {
      try {
        await fetch(`${API_BASE}/questions/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, stem: data.content, explanation: data.analysis, knowledge_point_ids: data.knowledge_ids, model_point_ids: data.model_ids }),
        });
      } catch (_err) {}
      db?.updateQuestion?.(editing.id, data);
    } else {
      db.createQuestion(data);
    }
    setModalVisible(false);
    setEditing(null);
    setVersions([]);
    form.resetFields();
    loadData();
  };

  const handleDelete = (id: string) => {
    (window as any).dbService.deleteQuestion(id);
    loadData();
  };

  const handleCopy = (id: string) => {
    const q = questions.find(x => x.id === id);
    if (!q) return;
    const db = (window as any).dbService;
    const { id: oid, created_at, updated_at, ...rest } = q;
    db.createQuestion({ ...rest });
    loadData();
    message.success('已创建变式题副本');
  };

  const handleBatchDelete = () => {
    const db = (window as any).dbService;
    selectedRowKeys.forEach(id => db.deleteQuestion(id));
    setSelectedRowKeys([]);
    loadData();
    message.success(`已删除 ${selectedRowKeys.length} 题`);
  };

  const handleBatchTag = () => {
    const tag = prompt('输入要添加的标签：');
    if (!tag) return;
    const db = (window as any).dbService;
    selectedRowKeys.forEach(id => {
      const q = questions.find(x => x.id === id);
      if (q) {
        const tags = [...new Set([...(q.tags || []), tag])];
        db.updateQuestion(id, { tags });
      }
    });
    loadData();
    message.success(`已为 ${selectedRowKeys.length} 题添加标签「${tag}」`);
  };

  const handleSearch = () => {
    setAppliedSearchText(searchText);
  };

  useEffect(() => {
    const focusQuestion = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      const target = document.getElementById(`question-card-${id}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('qb-question-card-focus');
        window.setTimeout(() => target.classList.remove('qb-question-card-focus'), 1600);
        return;
      }
      const exists = questions.some(question => question.id === id);
      if (exists) {
        message.info('该试题不在当前筛选结果中，可重置筛选后查看');
      }
    };
    window.addEventListener('question-basket-focus', focusQuestion as EventListener);
    return () => window.removeEventListener('question-basket-focus', focusQuestion as EventListener);
  }, [questions]);

  const handleBatchKnowledge = (knowledgeId: string) => {
    const db = (window as any).dbService;
    selectedRowKeys.forEach(id => {
      const q = questions.find(x => x.id === id);
      if (q) {
        if (db.addQuestionKnowledgePoints) {
          db.addQuestionKnowledgePoints(id, [knowledgeId]);
        } else {
          const ids = [...new Set([...(q.knowledge_ids || []), knowledgeId])];
          db.updateQuestion(id, { knowledge_ids: ids });
        }
      }
    });
    loadData();
  };

  const handleBatchModel = (modelId: string) => {
    const db = (window as any).dbService;
    selectedRowKeys.forEach(id => {
      const q = questions.find(x => x.id === id);
      if (q) {
        if (db.addQuestionModelPoints) {
          db.addQuestionModelPoints(id, [modelId]);
        } else {
          const ids = [...new Set([...(q.model_ids || []), modelId])];
          db.updateQuestion(id, { model_ids: ids, model_point: modelNodes.find(n => n.id === modelId)?.name || q.model_point || '' });
        }
      }
    });
    loadData();
  };

  // 批量组卷并导出为 Word
  const handleBatchGroupExam = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选需要组卷的题目');
      return;
    }

    const selectedQs = questions.filter(q => selectedRowKeys.includes(q.id));

    // 生成 Word 文档内容（HTML 格式，.doc 可打开）
    const htmlContent = generateExamWord(selectedQs);
    downloadAsWord(htmlContent, `组卷_${new Date().toISOString().slice(0, 10)}.doc`);
    message.success(`已导出 ${selectedQs.length} 题到 Word 文件`);
  };

  // 生成试卷 Word HTML
  const generateExamWord = (items: Question[]): string => {
    const typeLabels: Record<string, string> = {
      '单选题': '一、单选题',
      '多选题': '二、多选题',
      '实验题': '三、实验题',
      '解答题': '四、解答题',
      '判断题': '五、判断题',
    };

    // 按题型分组
    const groups: Record<string, Question[]> = {};
    items.forEach(q => {
      const t = normalizeQuestionType(q.type);
      if (!groups[t]) groups[t] = [];
      groups[t].push(q);
    });

    let html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>`;
    html += `<head><meta charset="UTF-8"><style>
      body { font-family: 'Times New Roman', '宋体', SimSun, serif; font-size: 12pt; padding: 40px; line-height: 1.8; }
      i, em { font-style: italic; }
      .q-stem i, .q-opt i { font-family: 'Times New Roman', serif; font-style: italic; }
      h1 { text-align: center; font-size: 18pt; margin-bottom: 20px; }
      .section-title { font-weight: bold; font-size: 14pt; margin: 20px 0 10px 0; }
      .question { margin-bottom: 20px; }
      .q-stem { margin-bottom: 4px; }
      .q-stem img { max-width: 100%; max-height: 280px; margin: 6px 0; }
      .q-options { display: flex; flex-wrap: wrap; gap: 4px 24px; margin: 8px 0 0 12px; }
      .q-options.cols-4 .q-opt { width: calc(25% - 18px); }
      .q-options.cols-2 .q-opt { width: calc(50% - 12px); }
      .q-opt { min-width: 80px; }
      .q-analysis { font-size: 10pt; color: #888; margin-top: 6px; }
      hr { border: none; border-top: 1px dashed #ccc; margin: 20px 0; }
      .answer-key { margin-top: 30px; border-top: 2px solid #000; padding-top: 10px; }
      .answer-key .section-title { font-size: 12pt; }
      table { border-collapse: collapse; width: 100%; }
      td { padding: 4px 8px; }
      ${KATEX_EXPORT_CSS}
    </style></head><body>`;

    html += `<h1>物理试卷</h1>`;
    html += `<p style="text-align:center;color:#666;font-size:10pt">组卷日期：${new Date().toLocaleDateString('zh-CN')}</p>`;
    html += `<hr/>`;

    let qNum = 1;
    const answerKeys: { num: number; content: string; answer: string }[] = [];

    Object.entries(typeLabels).forEach(([type, label]) => {
      if (!groups[type]) return;
      html += `<div class="section-title">${label}</div>`;
      groups[type].forEach(q => {
        html += `<div class="question">`;
        // 图片嵌入在题干 HTML 中保持真实位置，不再单独提取
        html += `<div class="q-stem"><b>${qNum}.</b> ${renderContentForExport(q.content || '')}</div>`;

        if (q.options && q.options.length > 0) {
          const optCount = q.options.length;
          const optCols = optCount === 4 ? 4 : optCount === 3 ? 3 : 2;
          html += `<div class="q-options cols-${optCols}">`;
          q.options.forEach((opt: string) => {
            html += `<div class="q-opt">${opt}</div>`;
          });
          html += `</div>`;
        }
        if (q.analysis) {
          html += `<div class="q-analysis">【解析】${q.analysis}</div>`;
        }
        html += `</div>`;
        answerKeys.push({ num: qNum, content: (q.content || '').replace(/<[^>]+>/g, '').substring(0, 40), answer: q.answer });
        qNum++;
      });
    });

    // 答案区域
    html += `<div class="answer-key"><div class="section-title">参考答案</div>`;
    html += `<table><tr><td style="width:40px"><b>题号</b></td><td><b>答案</b></td></tr>`;
    answerKeys.forEach(ak => {
      html += `<tr><td>${ak.num}</td><td>${ak.answer}</td></tr>`;
    });
    html += `</table></div>`;

    html += `</body></html>`;
    return html;
  };

  // 下载为 Word 文件（实际为 HTML，保存为 .doc 扩展名）
  const downloadAsWord = (html: string, filename: string) => {
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const difficultyColor = (d: number) => {
    if (d <= 2) return 'green';
    if (d <= 3) return 'orange';
    return 'red';
  };

  const openEditModal = (r: Question) => {
    const db = (window as any).dbService;
    setEditing(r);
    setVersions(db?.getLatestQuestionVersions?.(r.id, 5) || []);
    const knForm: Record<string, boolean> = {};
    (r.knowledge_ids || []).forEach(id => { knForm[id] = true; });
    const modelForm: Record<string, boolean> = {};
    (r.model_ids || []).forEach(id => { modelForm[id] = true; });
    form.setFieldsValue({
      subject: r.subject || '物理', type: normalizeQuestionType(r.type), difficulty: r.difficulty,
      content: r.content, options: (r.options || []).join('\n'),
      answer: r.answer, analysis: r.analysis,
      knowledge_point: r.knowledge_point,
      knowledge_ids: knForm,
      model_point: r.model_point,
      model_ids: modelForm,
      formulas: (r.formulas || []).join('\n'),
      tags: (r.tags || []).join(','),
      source: r.source, year: r.year, grade: r.grade,
              semester: r.semester, exam_type: r.exam_type || '其他',
              region: r.region, school: r.school,
    });
    setModalVisible(true);
  };

  const restoreVersion = (version: QuestionVersion) => {
    if (!editing) return;
    const db = (window as any).dbService;
    const restored = db?.restoreQuestionVersion?.(editing.id, version.id);
    if (!restored) {
      message.error('版本恢复失败');
      return;
    }
    message.success(`已恢复到版本 ${version.version_no}`);
    setModalVisible(false);
    setEditing(null);
    setVersions([]);
    form.resetFields();
    loadData();
  };

  const columns: any[] = [
    {
      title: '题干', dataIndex: 'content', key: 'content', ellipsis: true,
      render: (t: string, r: Question) => (
        <div>
          <QuestionRenderer content={t} inline />
          {r.tags && r.tags.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {r.tags.map(tag => <Tag key={tag} color="blue" style={{ fontSize: 10 }}>{tag}</Tag>)}
            </div>
          )}
        </div>
      )
    },
    { title: '科目', dataIndex: 'subject', key: 'subject', width: 65, render: (s: string) => <Tag>{s}</Tag> },
    { title: '题型', dataIndex: 'type', key: 'type', width: 75 },
    {
      title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 60,
      render: (d: number) => <Tag color={difficultyColor(d)}>{'★'.repeat(d)}</Tag>
    },
    {
      title: '知识点', key: 'knowledge', width: 120, ellipsis: true,
      render: (_: any, r: Question) => (
        <span style={{ fontSize: 12, color: '#666' }}>
          {(r.knowledge_ids || []).map(id => getNodeName(id)).join('、') || r.knowledge_point || '-'}
        </span>
      )
    },
    {
      title: '模型', key: 'model', width: 120, ellipsis: true,
      render: (_: any, r: Question) => (
        <span style={{ fontSize: 12, color: '#666' }}>
          {(r.model_ids || []).map(id => getModelName(id)).join('、') || r.model_point || '-'}
        </span>
      )
    },
    {
      title: '来源', key: 'source', width: 80,
      render: (_: any, r: Question) => r.exam_type ? <Tag>{r.exam_type}</Tag> : '-'
    },
    { title: '年级', dataIndex: 'grade', key: 'grade', width: 70, render: (g: string) => g || '-' },
    { title: '学年', dataIndex: 'year', key: 'year', width: 70, render: (y: string) => y || '-' },
    { title: '学期', dataIndex: 'semester', key: 'semester', width: 70, render: (s: string) => s || '-' },
    {
      title: '操作', key: 'action', width: 130,
      render: (_: any, r: Question) => (
        <Space size={0}>
          <Tooltip title="编辑"><Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)} /></Tooltip>
          <Tooltip title="创建变式"><Button type="link" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(r.id)} /></Tooltip>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Tooltip title="删除"><Button type="link" size="small" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      )
    },
  ];

  const menu = (
    <Menu onClick={({ key }) => handleBatchKnowledge(key)}>
      {knowledgeNodes.map(n => (
        <Menu.Item key={n.id}>{n.name}</Menu.Item>
      ))}
    </Menu>
  );

  const modelMenu = (
    <Menu onClick={({ key }) => handleBatchModel(key)}>
      {modelNodes.map(n => (
        <Menu.Item key={n.id}>{n.name}</Menu.Item>
      ))}
    </Menu>
  );

  const nodeTitleRender = useCallback((nodeData: any) => {
    const nodeId = nodeData.key as string;
    const nodeName = nodeData.title as string;
    const isIncluded = knowledgeSelectedIds.filter(id => !!id).includes(nodeId);
    const isExcluded = filterExcludeKnowledgeIds.includes(nodeId);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '1px 0' }}>
        <span style={{ flex: 1, userSelect: 'none', fontSize: 13 }}>{nodeName}</span>
        <Button type="link" size="small"
          style={{ color: isIncluded ? '#1890ff' : '#999', fontSize: 11, padding: '0 2px', minWidth: 'auto', height: 18 }}
          onClick={e => {
            e.stopPropagation();
            if (isIncluded) {
              setKnowledgeSelectedIds(prev => prev.filter(id => id !== nodeId));
            } else {
              setKnowledgeSelectedIds(prev => [...prev.filter(id => !!id), nodeId]);
              setFilterExcludeKnowledgeIds(prev => prev.filter(id => id !== nodeId));
            }
          }}
        >{isIncluded ? '✓已选' : '包含'}</Button>
        <Button type="link" size="small" danger={isExcluded}
          style={{ color: isExcluded ? '#ff4d4f' : '#999', fontSize: 11, padding: '0 2px', minWidth: 'auto', height: 18 }}
          onClick={e => {
            e.stopPropagation();
            if (isExcluded) {
              setFilterExcludeKnowledgeIds(prev => prev.filter(id => id !== nodeId));
            } else {
              setFilterExcludeKnowledgeIds(prev => [...prev, nodeId]);
              setKnowledgeSelectedIds(prev => prev.filter(id => id !== nodeId));
            }
          }}
        >{isExcluded ? '✗已排' : '不含'}</Button>
      </div>
    );
  }, [knowledgeSelectedIds, filterExcludeKnowledgeIds]);

  return (
    <Row gutter={16} className="qb-preview-page">
      {/* Knowledge Tree Sidebar */}
      {treeVisible && (
        <Col span={5} className="qb-preview-sidebar">
          <Card
            size="small"
            title={<span className="qb-tree-section-title"><BranchesOutlined /> 知识树</span>}
            extra={<Button type="link" size="small" onClick={() => setTreeVisible(false)}>收起</Button>}
            className="qb-preview-tree-card"
          >
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索知识点/模型"
              value={treeSearchText}
              onChange={event => setTreeSearchText(event.target.value)}
              className="qb-tree-search"
            />
            <div className="knowledge-tree">
            <Tree
              treeData={visibleTreeData} titleRender={nodeTitleRender}
              showIcon={false}
              showLine={{ showLeafIcon: false }}
              blockNode allowDrop={() => false}
              onSelect={(keys) => {
                if (keys.length > 0) {
                  setKnowledgeSelectedIds(keys as string[]);
                }
              }}
              style={{ fontSize: 13 }} />
            </div>
            <Divider className="qb-tree-divider" />
            <div className="qb-tree-section-title qb-model-tree-title"><BranchesOutlined /> 模型树</div>
            <div className="knowledge-tree">
              <Tree
                treeData={visibleModelTreeData}
                showIcon={false}
                showLine={{ showLeafIcon: false }}
                blockNode
                allowDrop={() => false}
                onSelect={(keys) => {
                  if (keys.length > 0) {
                    setModelSelectedIds(keys as string[]);
                  }
                }}
                style={{ fontSize: 13 }}
              />
            </div>
          </Card>
        </Col>
      )}

      {/* Main Content */}
      <Col span={treeVisible ? 19 : 24} className="qb-preview-main">
        <Card className="qb-preview-main-card">
          {/* Header */}
          <div className="qb-preview-header">
            <Space className="qb-preview-titlebar">
              {!treeVisible && (
                <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开知识点/模型</Button>
              )}
              <h2>试题预览</h2>
              <Select
                className="qb-subject-select"
                value={currentSubject}
                onChange={(value) => {
                  setFilterSubjects([value]);
                  setKnowledgeSelectedIds([undefined]);
                  setFilterExcludeKnowledgeIds([undefined]);
                  setModelSelectedIds([undefined]);
                }}
                options={SUBJECTS.map(subject => ({ label: subject, value: subject }))}
              />
              <Badge count={filtered.length} style={{ backgroundColor: '#1890ff' }} overflowCount={9999} />
            </Space>
            <Space>
              {selectedRowKeys.length > 0 && (
                <>
                  <Button
                    type="primary"
                    icon={<FileWordOutlined />}
                    onClick={handleBatchGroupExam}
                  >
                    批量组卷 ({selectedRowKeys.length})
                  </Button>
                </>
              )}
            </Space>
          </div>

          {/* Filters */}
          <div className="qb-filter-panel">
            <div className="qb-filter-row">
              <Select
                className="qb-filter-select"
                value={singleValue(filterGrades)}
                onChange={(value) => setSingleValue(setFilterGrades, value)}
                options={LIMIT_GRADES.map(item => ({ label: item, value: item }))}
                prefix="年级"
              />
              <Select
                className="qb-filter-select wide"
                value={filterYear}
                onChange={setFilterYear}
                options={[{ label: '全部', value: '全部' }, ...YEAR_OPTIONS]}
                prefix="学年"
              />
              <Select
                className="qb-filter-select"
                value={singleValue(filterSemesters)}
                onChange={(value) => setSingleValue(setFilterSemesters, value)}
                options={LIMIT_SEMESTERS.map(item => ({ label: item, value: item }))}
                prefix="学期"
              />
              <Select
                className="qb-filter-select"
                value={singleValue(filterTypes)}
                onChange={(value) => setSingleValue(setFilterTypes, value)}
                options={LIMIT_TYPES.map(item => ({ label: item, value: item }))}
                prefix="题型"
              />
              <Select
                className="qb-filter-select"
                value={singleValue(filterExamTypes)}
                onChange={(value) => setSingleValue(setFilterExamTypes, value)}
                options={LIMIT_EXAM_TYPES.map(item => ({ label: item, value: item }))}
                prefix="考试类型"
              />
              <Button icon={<FilterOutlined />} onClick={() => setMoreFiltersOpen(true)}>更多筛选</Button>
              <Button type="link" icon={<ReloadOutlined />} onClick={resetFilters}>重置</Button>
            </div>

            <div className="qb-filter-row qb-filter-row-secondary">
              <AntSelect
                mode="multiple"
                allowClear
                className="qb-filter-multi"
                placeholder="包含知识点"
                value={activeKnowledgeIds}
                onChange={(values) => setKnowledgeSelectedIds(values.length ? values : [undefined])}
                filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
                options={subjectKnowledgeNodes.map(n => ({ label: n.name, value: n.id }))}
              />
              <AntSelect
                mode="multiple"
                allowClear
                className="qb-filter-multi"
                placeholder="排除知识点"
                value={activeExcludeKnowledgeIds}
                onChange={(values) => setFilterExcludeKnowledgeIds(values.length ? values : [undefined])}
                filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
                options={subjectKnowledgeNodes.map(n => ({ label: n.name, value: n.id }))}
              />
              <AntSelect
                mode="multiple"
                allowClear
                className="qb-filter-multi"
                placeholder="模型"
                value={activeModelIds}
                onChange={(values) => setModelSelectedIds(values.length ? values : [undefined])}
                filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
                options={subjectModelNodes.map(n => ({ label: n.name, value: n.id }))}
              />
            </div>

            <div className="qb-search-row">
              <Input
                placeholder="题干搜索（支持关键词、题号、选项、小题内容）"
                allowClear
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={event => setSearchText(event.target.value)}
                onPressEnter={handleSearch}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
            </div>
          </div>

          <Drawer
            title="更多筛选"
            open={moreFiltersOpen}
            onClose={() => setMoreFiltersOpen(false)}
            width={420}
            className="qb-more-filter-drawer"
            footer={
              <div className="qb-more-filter-footer">
                <Button onClick={resetFilters}>重置全部</Button>
                <Button type="primary" onClick={() => setMoreFiltersOpen(false)}>完成</Button>
              </div>
            }
          >
            <div className="qb-more-filter-group">
              <Text strong>难度</Text>
              <Checkbox.Group
                options={LIMIT_DIFFICULTIES}
                value={filterDifficulties}
                onChange={(vals) => setFilterDifficulties(normalizeCheckGroup(vals as string[]))}
              />
            </div>
            <div className="qb-more-filter-group">
              <Text strong>发布状态</Text>
              <Checkbox.Group
                options={LIMIT_STATUSES}
                value={filterStatuses}
                onChange={(vals) => setFilterStatuses(normalizeCheckGroup(vals as string[]))}
              />
            </div>
            <div className="qb-more-filter-group">
              <Text strong>来源</Text>
              <Input allowClear placeholder="来源 / 地区 / 学校 / 年份" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} />
            </div>
            <div className="qb-more-filter-group">
              <Checkbox checked={basketOnly} onChange={event => setBasketOnly(event.target.checked)}>只看已加入试题篮</Checkbox>
            </div>
          </Drawer>
          {/* Batch Operations */}
          {selectedRowKeys.length > 0 && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 6 }}>
              <Space wrap>
                <CheckCircleOutlined style={{ color: '#1890ff' }} />
                <Text strong>已选 {selectedRowKeys.length} 题</Text>
                <Button size="small" onClick={handleBatchTag}><TagsOutlined /> 批量打标签</Button>
                <Dropdown overlay={menu}>
                  <Button size="small"><AimOutlined /> 批量关联知识点</Button>
                </Dropdown>
                <Dropdown overlay={modelMenu}>
                  <Button size="small"><BranchesOutlined /> 批量关联模型</Button>
                </Dropdown>
                <Popconfirm title={`确定删除选中的 ${selectedRowKeys.length} 题？`} onConfirm={handleBatchDelete}>
                  <Button size="small" danger><DeleteOutlined /> 批量删除</Button>
                </Popconfirm>
                <Button size="small" icon={<FileWordOutlined />} type="primary" onClick={handleBatchGroupExam}>
                  批量组卷
                </Button>
                <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
              </Space>
            </div>
          )}

          {/* Table */}
          <div className="qb-question-display-toolbar">
            <Text type="secondary">共 {dedupedFiltered.length} 题，第 {safeCurrentPage}/{totalPages} 页</Text>
            <Space>
              <Button onClick={() => setQuestionZoom(zoom => Math.max(0.75, Number((zoom - 0.1).toFixed(2))))}>缩小</Button>
              <InputNumber
                min={75}
                max={160}
                step={5}
                value={Math.round(questionZoom * 100)}
                formatter={value => `${value}%`}
                parser={value => Number(String(value || '').replace('%', ''))}
                onChange={value => setQuestionZoom(Math.min(1.6, Math.max(0.75, Number(value || 100) / 100)))}
                style={{ width: 90 }}
              />
              <Button onClick={() => setQuestionZoom(1)}>100%</Button>
              <Button onClick={() => setQuestionZoom(zoom => Math.min(1.6, Number((zoom + 0.1).toFixed(2))))}>放大</Button>
            </Space>
          </div>
          <div className="qb-question-display-viewport">
            <div className="qb-question-display-stage" style={{ zoom: questionZoom } as React.CSSProperties}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dedupedFiltered.length === 0 ? <Empty description="暂无试题" /> : visibleFiltered.map((q, idx) => {
              const inBasket = basketIds.includes(q.id);
              return (
                <QuestionPreviewCard
                  key={q.id}
                  question={q}
                  index={(safeCurrentPage - 1) * QUESTION_PAGE_SIZE + idx}
                  terms={searchTerms}
                  knowledgeNames={(q.knowledge_ids || []).map(getNodeName)}
                  modelNames={(q.model_ids || []).map(getModelName)}
                  inBasket={inBasket}
                  onEdit={() => openEditModal(q)}
                  onToggleBasket={() => toggleQuestionBasket(q.id)}
                />
              );
            })}
              </div>
            </div>
          </div>
          {dedupedFiltered.length > 0 && (
            <div className="qb-question-pagination">
              <Pagination
                current={safeCurrentPage}
                total={dedupedFiltered.length}
                pageSize={QUESTION_PAGE_SIZE}
                showSizeChanger={false}
                showQuickJumper
                showTotal={total => `共 ${total} 题`}
                onChange={page => setCurrentPage(page)}
              />
            </div>
          )}
        </Card>
      </Col>

      {/* Preview Modal */}
      <Modal
        title={<span><EyeOutlined /> 题目预览</span>}
        open={!!previewQuestion}
        onCancel={() => setPreviewQuestion(null)}
        footer={<Button onClick={() => setPreviewQuestion(null)}>关闭</Button>}
        width={700}
        destroyOnClose
      >
        {previewQuestion && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue">{previewQuestion.subject}</Tag>
              <Tag color="purple">{previewQuestion.type}</Tag>
              <Tag color={difficultyColor(previewQuestion.difficulty)}>{'★'.repeat(previewQuestion.difficulty)}</Tag>
              {previewQuestion.exam_type && <Tag>{previewQuestion.exam_type}</Tag>}
              {previewQuestion.grade && <Tag>{previewQuestion.grade}</Tag>}
              {previewQuestion.year && <Tag>{previewQuestion.year}</Tag>}
            </div>
            <QuestionRenderer
              content={previewQuestion.content}
              options={previewQuestion.options}
              questionType={previewQuestion.type}
              answer={previewQuestion.answer}
              analysis={previewQuestion.analysis}
            />
          </div>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        title={editing ? '编辑题目' : '添加题目'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => { setModalVisible(false); setEditing(null); setVersions([]); form.resetFields(); }}
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
              <Form.Item name="region" label="地区"><Input /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="school" label="学校"><Input /></Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="grade" label="年级">
                <Select allowClear>{['高一', '高二', '高三', '复习'].map(g => <Select.Option key={g} value={g}>{g}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="year" label="年份"><Input placeholder="2026" /></Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="semester" label="学期">
                <Select allowClear>{['上学期', '下学期'].map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}</Select>
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
          {editing && (
            <>
              <Divider orientation="left" style={{ fontSize: 12 }}>版本记录</Divider>
              {versions.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史版本" />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {versions.map(version => (
                    <Card key={version.id} size="small" bodyStyle={{ padding: 10 }}>
                      <Row align="middle" gutter={12}>
                        <Col flex="80px"><Tag color="blue">版本 {version.version_no}</Tag></Col>
                        <Col flex="auto">
                          <div style={{ fontSize: 12, color: '#666' }}>{new Date(version.created_at).toLocaleString()}</div>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {version.snapshot.content || '空题干'}
                          </div>
                        </Col>
                        <Col><Button size="small" onClick={() => restoreVersion(version)}>恢复</Button></Col>
                      </Row>
                    </Card>
                  ))}
                </Space>
              )}
            </>
          )}
        </Form>
      </Modal>
    </Row>
  );
};

export default QuestionBankPreview;



