import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Button, Modal, Form, Input, Select as AntSelect, Space, Tag, message,
  Popconfirm, Tooltip, Tree, Divider, Badge, Checkbox, Dropdown, Menu, Empty, Row, Col, Typography, Drawer,
  Pagination, Alert
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, CopyOutlined,
  FolderOpenOutlined, TagsOutlined, AimOutlined, BranchesOutlined,
  CheckCircleOutlined, FileWordOutlined, CloseCircleOutlined, EyeOutlined,
  FilterOutlined, ReloadOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode, QuestionVersion, TaxonomySystem } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import TaxonomyManager from '../components/TaxonomyManager';
const { questionDeletePresentation } = require('../services/questionDeletionPresentation');
const { normalizeDesktopQuestionDeleteContext, verifyNativeQuestionDraft } = require('../services/desktopQuestionDeleteContext');
const { createNativeQuestionDraft } = require('../services/nativeQuestionDraftCreate');
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { QUESTION_TYPES, normalizeQuestionType } from '../constants/questionTypes';
import { splitSearchTerms } from '../utils/highlightText';
import { setQuestionBasket, toggleQuestionBasket, useQuestionBasketIds } from '../components/QuestionBasket';
import QuestionPreviewCard from '../components/QuestionPreviewCard';
import QuestionRenderer, { createKaTeXPhysicsOptions } from '../components/QuestionRenderer';
import QuestionStructureEditor from '../components/question-editor/QuestionStructureEditor';
import { normalizeStructureOrder, validateQuestionStructure } from '../components/question-editor/questionStructureOperations';
import type { QuestionRichDocument } from '../types/questionRichContent';
import { createQuestionRichDocument } from '../types/questionRichContent';
import { migrateLegacyQuestion, projectQuestionRichContent } from '../services/questionRichContent';
import { createQuestionEditorSaveGate, createRichDocumentDirtyCoordinator, registerEditorSpaExitGuard, shouldProtectEditorExit } from '../components/question-editor/questionEditorSession'; // utf-8
import {
  cacheQuestionTrees,
  ensureQuestionLocalStoreSeeded,
  getCachedQuestionTree,
  queryQuestionPage,
} from '../services/questionLocalStore';
import './QuestionBankPreview.css';

const legacyTaxonomyUiEnabled = () => false;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;
// utf-8
const QUESTION_PAGE_SIZE = 10;

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
  const [questionTotal, setQuestionTotal] = useState(0);
  const [localStoreReady, setLocalStoreReady] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);
  const [taxonomySystems, setTaxonomySystems] = useState<TaxonomySystem[]>([]);
  const [taxonomyNodes, setTaxonomyNodes] = useState<Record<string, KnowledgeNode[]>>({});
  const [taxonomySelections, setTaxonomySelections] = useState<Record<string, { include: string[]; exclude: string[] }>>({});

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
  const [richDocument, setRichDocument] = useState<QuestionRichDocument | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [treeVisible, setTreeVisible] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeName, setEditingNodeName] = useState('');
  const [addingChildParentId, setAddingChildParentId] = useState<string | null | '__ROOT__'>(null);
  const [addingChildName, setAddingChildName] = useState('');
  const [contextMenuNode, setContextMenuNode] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<{ id: string; name: string } | null>(null);
  const [deleteContext, setDeleteContext] = useState<{ capabilities: string[]; deviceId?: string; userId?: string }>({ capabilities: [] });
  const [form] = Form.useForm();
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
    try {
      setDeleteContext(normalizeDesktopQuestionDeleteContext(readDesktopAuthorizationSession()));
    } catch (_error) {}
  }, []);

  // Knowledge multi-select search state
  const [knowledgeSelectedIds, setKnowledgeSelectedIds] = useState<(string | undefined)[]>([undefined]);

  const dbService = (window as any).dbService;

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
    taxonomy_ids: row.taxonomy_ids || {
      knowledge: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
      model: row.model_ids ?? row.model_point_ids ?? [],
    },
  } as Question);

  const loadData = useCallback(async () => {
    try {
      const db = (window as any).dbService;
      await db?.refreshAuthorityProjection?.();
      const cachedKnowledge = await getCachedQuestionTree('knowledge');
      const cachedModels = await getCachedQuestionTree('model');
      if (cachedKnowledge.length > 0) setKnowledgeNodes(cachedKnowledge);
      if (cachedModels.length > 0) setModelNodes(cachedModels);
      if (db) {
        const kn = db.getKnowledgeTree?.() || [];
        const models = db.getModelTree?.() || [];
        if (kn.length > 0) setKnowledgeNodes(kn);
        if (models.length === 0) {
          db.initDefaultModelTree?.();
          const nextModels = db.getModelTree?.() || [];
          setModelNodes(nextModels);
          cacheQuestionTrees(kn, nextModels).catch(() => undefined);
        } else {
          setModelNodes(models);
          cacheQuestionTrees(kn, models).catch(() => undefined);
        }
        await ensureQuestionLocalStoreSeeded(() => (db.getAllQuestions?.() || []).map(normalizeQuestion));
        setLocalStoreReady(true);
        setRefreshNonce(value => value + 1);
      }
    } catch (e) {
      console.error('QuestionBankPreview loadData error:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!contextMenuNode) return;
    const close = () => setContextMenuNode(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenuNode]);

  const activeKnowledgeIds = knowledgeSelectedIds.filter((id): id is string => !!id);
  const activeModelIds = modelSelectedIds.filter((id): id is string => !!id);
  const activeExcludeKnowledgeIds = filterExcludeKnowledgeIds.filter((id): id is string => !!id);
  const searchTerms = useMemo(() => splitSearchTerms(appliedSearchText), [appliedSearchText]);
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
    setTaxonomySelections({});
    setSearchText('');
    setAppliedSearchText('');
  };

  // 将知识点 ID 展开为所有底层后代（用于筛选）
  const expandedIncludeGroups = useMemo(() => activeKnowledgeIds
    .filter(id => !!id)
    .map(id => getDescendantIds(knowledgeNodes, id)), [activeKnowledgeIds.join(','), knowledgeNodes]);
  const expandedExcludeIds = useMemo(() => filterExcludeKnowledgeIds
    .filter((id): id is string => !!id)
    .flatMap(id => getDescendantIds(knowledgeNodes, id)), [filterExcludeKnowledgeIds.join(','), knowledgeNodes]);
  const expandedModelGroups = useMemo(() => activeModelIds
    .filter(id => !!id)
    .map(id => getDescendantIds(modelNodes, id)), [activeModelIds.join(','), modelNodes]);
  const expandedTaxonomyFilters = useMemo(() => Object.fromEntries(taxonomySystems.map(system => {
    const selection = taxonomySelections[system.id] || { include: [], exclude: [] };
    const nodes = taxonomyNodes[system.id] || [];
    return [system.id, {
      includeGroups: selection.include.map(id => getDescendantIds(nodes, id)),
      excludeIds: selection.exclude.flatMap(id => getDescendantIds(nodes, id)),
    }];
  })), [taxonomySystems, taxonomyNodes, taxonomySelections]);

  const getNodeName = (id: string) => {
    const n = knowledgeNodes.find(x => x.id === id);
    return n ? n.name : id;
  };

  const getModelName = (id: string) => {
    const n = modelNodes.find(x => x.id === id);
    return n ? n.name : id;
  };

  const refreshQuestionPage = useCallback(async () => {
    if (!localStoreReady) return;
    setPageLoading(true);
    try {
      const result = await queryQuestionPage({
        page: currentPage,
        pageSize: QUESTION_PAGE_SIZE,
        subjectIds: filterSubjects,
        types: filterTypes,
        examTypes: filterExamTypes,
        statuses: filterStatuses,
        grades: filterGrades,
        semesters: filterSemesters,
        difficulties: filterDifficulties,
        year: filterYear,
        basketIds,
        basketOnly,
        source: sourceFilter,
        searchTerms,
        taxonomyFilters: expandedTaxonomyFilters,
        dedupe: true,
      });
      setQuestionTotal(result.total);
      setQuestions(result.rows.map(normalizeQuestion));
    } finally {
      setPageLoading(false);
    }
  }, [
    localStoreReady, refreshNonce, currentPage, filterSubjects, filterTypes, filterExamTypes, filterStatuses,
    filterGrades, filterSemesters, filterDifficulties, filterYear, basketIds, basketOnly,
    sourceFilter, searchTerms, expandedTaxonomyFilters,
  ]);

  useEffect(() => { refreshQuestionPage(); }, [refreshQuestionPage]);

  const dedupedFiltered = questions;
  const filtered = questions;
  const totalPages = Math.max(1, Math.ceil(questionTotal / QUESTION_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleFiltered = questions;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedSearchText, filterSubjects, filterTypes, filterExamTypes, filterGrades, filterSemesters, filterYear, filterDifficulties, filterStatuses, basketOnly, sourceFilter, activeKnowledgeIds.join(','), activeModelIds.join(','), expandedExcludeIds.join(',')]);

  const jumpToQuestionPage = useCallback((page: number) => {
    setCurrentPage(page);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, []);

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
  const handleTaxonomiesChanged = useCallback((systems: TaxonomySystem[], nodes: Record<string, KnowledgeNode[]>) => {
    setTaxonomySystems(systems);
    setTaxonomyNodes(nodes);
    setKnowledgeNodes(nodes.knowledge || []);
    setModelNodes(nodes.model || []);
    setTaxonomySelections(previous => Object.fromEntries(systems.map(system => [
      system.id,
      previous[system.id] || { include: [], exclude: [] },
    ])));
  }, []);
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

  const renderTaxonomyCheckboxes = (systemId: string, nodes: KnowledgeNode[], parentId?: string, depth = 0): React.ReactNode => {
    const children = nodes.filter(node => node.parent_id === parentId || (!parentId && !node.parent_id)).sort((a, b) => a.order - b.order);
    if (children.length === 0) return null;
    return <div style={{ marginLeft: depth * 20 }}>
      {children.map(node => <div key={node.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <Form.Item name={['taxonomy_ids', systemId, node.id]} valuePropName="checked" noStyle><Checkbox /></Form.Item>
          <span style={{ fontWeight: node.parent_id ? 'normal' : 600 }}>{node.name}</span>
        </div>
        {renderTaxonomyCheckboxes(systemId, nodes, node.id, depth + 1)}
      </div>)}
    </div>;
  };

  const handleSave = async () => {
    if (!richDocument) return;
    const structureErrors = validateQuestionStructure(richDocument, form.getFieldValue('type'));
    if (structureErrors.length > 0) { message.error(structureErrors[0]); return; }
    const values = await form.validateFields();
    const db = (window as any).dbService;
    const projection = projectQuestionRichContent(richDocument);

    const taxonomy_ids = Object.fromEntries(taxonomySystems.map(system => [
      system.id,
      Object.entries(values.taxonomy_ids?.[system.id] || {}).filter(([, checked]) => checked).map(([id]) => id),
    ]));
    const knowledge_ids: string[] = taxonomy_ids.knowledge || [];
    const model_ids: string[] = taxonomy_ids.model || [];

    const data: any = {
      subject: values.subject,
      type: normalizeQuestionType(values.type),
      difficulty: values.difficulty,
      content: projection.stem,
      options: projection.options.map(option => ({ label: option.label, content: option.content, is_correct: option.isCorrect })),
      answer: projection.answer,
      analysis: projection.explanation,
      sub_questions: projection.subQuestions,
      rich_content: richDocument,
      knowledge_ids,
      knowledge_point: values.knowledge_point || '',
      model_ids,
      taxonomy_ids,
      model_point: model_ids.length > 0 ? modelNodes.find(n => n.id === model_ids[0])?.name || '' : '',
      formulas: projection.formulas,
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
      has_image: projection.hasImage,
      has_formula: projection.hasFormula,
      created_by: editing?.created_by || '',
    };

    if (editing) {
      if (!db?.updateQuestion) throw new Error('LOCAL_QUESTION_STORE_UNAVAILABLE');
      if (db.updateQuestion(editing.id, data) !== true) throw new Error('LOCAL_QUESTION_UPDATE_FAILED');
    } else {
      try { await createNativeQuestionDraft(db, data); } catch (_error) { message.error('DRAFT_PROVENANCE_UNAVAILABLE'); return; }
    }
    richDirtyCoordinator.markSaved(richDocument);
    formDirtyRef.current = false;
    setModalVisible(false);
    setEditing(null);
    setRichDocument(null);
    setEditorDirty(false);
    setVersions([]);
    form.resetFields();
    loadData();
  };

  const handleDelete = async (id: string) => {
    const question = questions.find(item => item.id === id);
    const presentation = questionDeletePresentation(question, deleteContext);
    if (!presentation.enabled) { message.warning(presentation.reason); return; }
    let ok = false;
    if (question?.storage_state === 'cloud_cached') {
      ok = Boolean((window as any).dbService.deleteCloudCachedQuestion(id));
    } else { const session = readDesktopAuthorizationSession(); ok = Boolean((window as any).dbService.deleteQuestion(id, await verifyNativeQuestionDraft(id, session))); }
    if (!ok) { message.error('Delete failed'); return; }
    setQuestions(previous => previous.filter(item => item.id !== id));
    setQuestionTotal(previous => Math.max(0, previous - 1));
  };

  const handleCopy = async (id: string) => {
    const q = questions.find(x => x.id === id);
    if (!q) return;
    const db = (window as any).dbService;
    const { id: oid, created_at, updated_at, ...rest } = q;
    try { await createNativeQuestionDraft(db, { ...rest }); } catch (_error) { message.error('DRAFT_PROVENANCE_UNAVAILABLE'); return; }
    loadData();
    message.success('已创建变式题副本');
  };

  const handleBatchDelete = async () => {
    const db = (window as any).dbService;
    const allowed = selectedRowKeys.filter(id => questionDeletePresentation(questions.find(item => item.id === id), deleteContext).enabled);
    const settled = await Promise.allSettled(allowed.map(async id => {
      const question = questions.find(item => item.id === id);
      const ok = question?.storage_state === 'cloud_cached'
        ? Boolean(db.deleteCloudCachedQuestion(id))
        : Boolean(db.deleteQuestion(id, await verifyNativeQuestionDraft(id, readDesktopAuthorizationSession())));
      if (!ok) throw new Error('DELETE_FAILED'); return id;
    }));
    const succeeded = settled.filter((item): item is PromiseFulfilledResult<string> => item.status === 'fulfilled').map(item => item.value);
    setQuestions(previous => previous.filter(item => !succeeded.includes(item.id)));
    setQuestionTotal(previous => Math.max(0, previous - succeeded.length));
    setSelectedRowKeys(previous => previous.filter(id => !succeeded.includes(id)));
    message.info(`Deleted ${succeeded.length}; failed ${selectedRowKeys.length - succeeded.length}`);
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

  // Move the chosen questions into the shared basket. The editor owns cloud export.
  const handleBatchGroupExam = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选需要组卷的题目');
      return;
    }
    const selected = Array.from(new Set(selectedRowKeys));
    setQuestionBasket(selected);
    localStorage.setItem('question_basket_selected', JSON.stringify(selected));
    window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'question-bank-paper' }));
  };

  const difficultyColor = (d: number) => {
    if (d <= 2) return 'green';
    if (d <= 3) return 'orange';
    return 'red';
  };

  const openEditModal = (r: Question) => {
    const db = (window as any).dbService;
    setEditing(r);
    openRichDocument(normalizeStructureOrder(r.rich_content?.type === 'question-document' ? createQuestionRichDocument(r.rich_content) : migrateLegacyQuestion(r as any)));
    setVersions(db?.getLatestQuestionVersions?.(r.id, 5) || []);
    const knForm: Record<string, boolean> = {};
    (r.knowledge_ids || []).forEach(id => { knForm[id] = true; });
    const modelForm: Record<string, boolean> = {};
    (r.model_ids || []).forEach(id => { modelForm[id] = true; });
    const taxonomyForm = Object.fromEntries(taxonomySystems.map(system => [
      system.id,
      Object.fromEntries((r.taxonomy_ids?.[system.id] || (system.id === 'knowledge' ? r.knowledge_ids : system.id === 'model' ? r.model_ids : []) || []).map(id => [id, true])),
    ]));
    form.setFieldsValue({
      subject: r.subject || '物理', type: normalizeQuestionType(r.type), difficulty: r.difficulty,
      knowledge_point: r.knowledge_point,
      knowledge_ids: knForm,
      model_point: r.model_point,
      model_ids: modelForm,
      taxonomy_ids: taxonomyForm,
      tags: (r.tags || []).join(','),
      source: r.source, year: r.year, grade: r.grade,
              semester: r.semester, exam_type: r.exam_type || '其他',
              region: r.region, school: r.school,
    });
    setModalVisible(true);
  };

  // utf-8 restore confirmation
  const restoreVersion = (version: QuestionVersion) => {
    if (!editing) return;
    const restore = () => {
      const db = (window as any).dbService;
      const restored = db?.restoreQuestionVersion?.(editing.id, version.id);
      if (!restored) { message.error('\u7248\u672c\u6062\u590d\u5931\u8d25'); return; }
      message.success(`\u5df2\u6062\u590d\u5230\u7248\u672c ${version.version_no}`);
      setModalVisible(false); setEditing(null); setRichDocument(null); setEditorDirty(false); setVersions([]); form.resetFields(); loadData();
    };
    if (!editorDirty) restore();
    else Modal.confirm({ title: '\u5f53\u524d\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58', content: '\u6062\u590d\u5386\u53f2\u7248\u672c\u5c06\u4e22\u5f03\u5f53\u524d\u4fee\u6539\uff0c\u662f\u5426\u7ee7\u7eed\uff1f', onOk: restore });
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
        <Space size={0} className={questionDeletePresentation(r, deleteContext).visible ? '' : 'question-delete-hidden'}>
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
            title={<span className="qb-tree-section-title"><BranchesOutlined /> 体系</span>}
            extra={<Button type="link" size="small" onClick={() => setTreeVisible(false)}>收起</Button>}
            className="qb-preview-tree-card"
          >
            <TaxonomyManager subject={currentSubject} database={dbService} onChanged={handleTaxonomiesChanged} />
            {legacyTaxonomyUiEnabled() && <>
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
            <div className="qb-tree-section-title qb-model-tree-title"><AimOutlined /> 模型树</div>
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
            </>}
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
                <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开体系</Button>
              )}
              <Select
                className="qb-subject-select"
                value={currentSubject}
                onChange={(value) => {
                  setFilterSubjects([value]);
                  setKnowledgeSelectedIds([undefined]);
                  setFilterExcludeKnowledgeIds([undefined]);
                  setModelSelectedIds([undefined]);
                  setTaxonomySelections({});
                }}
                options={SUBJECTS.map(subject => ({ label: subject, value: subject }))}
              />
              <Badge count={questionTotal} style={{ backgroundColor: '#1890ff' }} overflowCount={9999} />
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
              {taxonomySystems.map(system => {
                const selection = taxonomySelections[system.id] || { include: [], exclude: [] };
                const options = (taxonomyNodes[system.id] || []).map(node => ({ label: node.name, value: node.id }));
                return <div key={system.id} className="taxonomy-filter-pair">
                  <Text strong>{system.name}</Text>
                  <AntSelect
                    mode="multiple"
                    allowClear
                    placeholder={`${'\u5305\u542b'}${system.name}`}
                    value={selection.include}
                    options={options}
                    onChange={include => setTaxonomySelections(previous => ({
                      ...previous,
                      [system.id]: { include, exclude: (previous[system.id]?.exclude || []).filter(id => !include.includes(id)) },
                    }))}
                  />
                  <AntSelect
                    mode="multiple"
                    allowClear
                    placeholder={`${'\u6392\u9664'}${system.name}`}
                    value={selection.exclude}
                    options={options}
                    onChange={exclude => setTaxonomySelections(previous => ({
                      ...previous,
                      [system.id]: { include: (previous[system.id]?.include || []).filter(id => !exclude.includes(id)), exclude },
                    }))}
                  />
                </div>;
              })}
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
            <Text type="secondary">共 {questionTotal} 题，第 {safeCurrentPage}/{totalPages} 页</Text>
          </div>
          <div className="qb-question-display-viewport">
            <div className="qb-question-display-stage">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {questionTotal === 0 && !pageLoading ? <Empty description="暂无试题" /> : visibleFiltered.map((q, idx) => {
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
          {questionTotal > 0 && (
            <div className="qb-question-pagination">
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
          )}
        </Card>
      </Col>

      {/* Preview Modal */}
      <Modal
        title={<span><EyeOutlined /> 查看题目</span>}
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
        wrapClassName="taxonomy-edit-modal"
        onOk={async () => { setSaving(true); const result = await saveGate(handleSave); if (!result.ok && result.owned) message.error(`\u4fdd\u5b58\u5931\u8d25\uff1a${(result.error as any)?.message || '\u8bf7\u91cd\u8bd5'}`); if (result.owned) setSaving(false); }}
        onCancel={() => {
          const close = () => { setModalVisible(false); setEditing(null); setRichDocument(null); setEditorDirty(false); setVersions([]); form.resetFields(); };
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
              <Form.Item name="difficulty" label="难度" rules={[{ required: true }]}>
                <Select>{[1,2,3,4,5].map(d => <Select.Option key={d} value={d}>{'★'.repeat(d)}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
          </Row>

          {/* utf-8 rich structure */}
          {richDocument && <QuestionStructureEditor value={richDocument} disabled={saving} questionType={editorQuestionType} onChange={updateRichDocument} />}

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
            {/* utf-8 metadata */}
            <Col span={24}>
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
          {taxonomySystems.map(system => <Form.Item key={system.id} label={system.name}>
            <div style={{ maxHeight: 200, overflow: 'auto', background: '#fafafa', padding: 12, borderRadius: 6 }}>
              {(taxonomyNodes[system.id] || []).length > 0
                ? renderTaxonomyCheckboxes(system.id, taxonomyNodes[system.id] || [])
                : <Empty description={'\u6682\u65e0\u8282\u70b9\u6570\u636e'} />}
            </div>
          </Form.Item>)}
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
