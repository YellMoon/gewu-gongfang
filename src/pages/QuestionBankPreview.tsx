import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Modal, Form, Input, Select as AntSelect, Space, Tag, message,
  Popconfirm, Tooltip, Tree, Divider, Badge, Checkbox, Dropdown, Menu, Empty, Row, Col, Typography
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, CopyOutlined,
  FolderOpenOutlined, TagsOutlined, AimOutlined, BranchesOutlined,
  CheckCircleOutlined, FileWordOutlined, CloseCircleOutlined, ShoppingCartOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType } from '../constants/questionTypes';
import { highlightText, splitSearchTerms } from '../utils/highlightText';
import { toggleQuestionBasket, useQuestionBasketIds } from '../components/QuestionBasket';

const { TextArea } = Input;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;
const API_BASE = getApiBase('/api/question-bank');

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试', '竞赛', '强基计划', '其他'];
const GRADES = ['高一', '高二', '高三'];
const LIMIT_GRADES = ['全部', ...GRADES];
const LIMIT_SEMESTERS = ['全部', '上学期', '下学期'];
const LIMIT_TYPES = ['全部', ...QUESTION_TYPES];
const SEMESTERS = ['上学期', '下学期'];
const LIMIT_EXAM_TYPES = ['全部', ...EXAM_TYPES];
const LIMIT_DIFFICULTIES = ['全部', '1', '2', '3', '4', '5'];
const LIMIT_STATUSES = [
  { label: '全部', value: '全部' },
  { label: '草稿', value: 'draft' },
  { label: '待审核', value: 'pending' },
  { label: '已发布', value: 'published' },
  { label: '已下线', value: 'offline' },
  { label: '已废弃', value: 'deprecated' },
];
const MEDIA_FILTERS = [
  { label: '全部', value: '全部' },
  { label: '含图片', value: 'image' },
  { label: '含公式', value: 'formula' },
];

const YEAR_OPTIONS = Array.from({ length: 18 }, (_, i) => {
  const start = 2009 + i;
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

const QuestionBankPreview: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [modelNodes, setModelNodes] = useState<KnowledgeNode[]>([]);

  // Multi-select filter state
  const [filterSubjects, setFilterSubjects] = useState<string[]>([]); // default: 全部
  const [filterTypes, setFilterTypes] = useState<string[]>(['全部']); // default: 全部
  const [filterExamTypes, setFilterExamTypes] = useState<string[]>(['全部']); // default: 全部
  const [filterGrades, setFilterGrades] = useState<string[]>(['全部']); // default: 全部
  const [filterSemesters, setFilterSemesters] = useState<string[]>(['全部']); // default: 全部
  const [filterYear, setFilterYear] = useState<string | undefined>(undefined);
  const [filterDifficulties, setFilterDifficulties] = useState<string[]>(['全部']);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(['全部']);
  const [filterMedia, setFilterMedia] = useState<string[]>(['全部']);

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
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
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
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
  } as Question);

  const loadData = useCallback(async () => {
    try {
      const db = (window as any).dbService;
      let localQuestions: Question[] = [];
      if (db) localQuestions = (db.getAllQuestions?.() || []).map(normalizeQuestion);
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
      const models = db.getModelTree?.() || [];
      setModelNodes(models);
      if (models.length === 0) {
        db.initDefaultModelTree?.();
        setModelNodes(db.getModelTree?.() || []);
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
  const searchTerms = splitSearchTerms(appliedSearchText);
  const normalizeCheckGroup = (vals: any[]): string[] => {
    if (vals.includes('全部') && vals.length > 1) {
      return vals.filter(v => v !== '全部') as string[];
    }
    return vals.length === 0 ? ['全部'] : vals as string[];
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
    if (!filterDifficulties.includes('全部') && filterDifficulties.length > 0 && !filterDifficulties.includes(String(q.difficulty || ''))) return false;
    if (!filterStatuses.includes('全部') && filterStatuses.length > 0 && !filterStatuses.includes(q.status || 'draft')) return false;
    if (!filterMedia.includes('全部') && filterMedia.length > 0) {
      if (filterMedia.includes('image') && !q.has_image) return false;
      if (filterMedia.includes('formula') && !q.has_formula) return false;
    }
    if (!filterGrades.includes('全部') && filterGrades.length > 0 && !filterGrades.includes(q.grade || '')) return false;
    if (!filterSemesters.includes('全部') && filterSemesters.length > 0 && !filterSemesters.includes(q.semester || '')) return false;
    if (filterYear && q.year !== filterYear) return false;
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

  const treeData = buildTreeData(knowledgeNodes);
  const modelTreeData = buildTreeData(modelNodes);

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
      body { font-family: '宋体', SimSun, serif; font-size: 12pt; padding: 40px; line-height: 1.8; }
      h1 { text-align: center; font-size: 18pt; margin-bottom: 20px; }
      .section-title { font-weight: bold; font-size: 14pt; margin: 20px 0 10px 0; }
      .question { margin-bottom: 16px; }
      .q-stem { margin-bottom: 4px; }
      .q-options { margin-left: 20px; }
      .q-answer { margin-top: 4px; color: #999; }
      hr { border: none; border-top: 1px dashed #ccc; margin: 20px 0; }
      .answer-key { margin-top: 30px; border-top: 2px solid #000; padding-top: 10px; }
      .answer-key .section-title { font-size: 12pt; }
      table { border-collapse: collapse; width: 100%; }
      td { padding: 4px 8px; }
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
        html += `<div class="q-stem"><b>${qNum}.</b> ${q.content}</div>`;
        if (q.options && q.options.length > 0) {
          html += `<div class="q-options">`;
          q.options.forEach((opt: string) => {
            html += `<div>${opt}</div>`;
          });
          html += `</div>`;
        }
        if (q.analysis) {
          html += `<div style="font-size:10pt;color:#888;margin-top:4px">【解析】${q.analysis}</div>`;
        }
        html += `</div>`;
        answerKeys.push({ num: qNum, content: q.content.substring(0, 40), answer: q.answer });
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
    setEditing(r);
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

  const columns: any[] = [
    {
      title: '题干', dataIndex: 'content', key: 'content', ellipsis: true,
      render: (t: string, r: Question) => (
        <div>
          <div style={{ maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</div>
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
    <Row gutter={16}>
      {/* Knowledge Tree Sidebar */}
      {treeVisible && (
        <Col span={5}>
          <Card
            size="small"
            title={<span><BranchesOutlined /> 知识点</span>}
            extra={<Button type="link" size="small" onClick={() => setTreeVisible(false)}>收起</Button>}
            style={{ height: '100%' }}
          >
            <div className="knowledge-tree">
            <Tree
              treeData={treeData} titleRender={nodeTitleRender}
              defaultExpandAll
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
            <Divider />
            <div style={{ color: '#666', fontSize: 12 }}>
              <div>题目总数：{questions.length}</div>
              <div>知识点：{knowledgeNodes.length}</div>
              <div>模型：{modelNodes.length}</div>
              {selectedRowKeys.length > 0 && (
                <div style={{ color: '#1890ff', fontWeight: 'bold', marginTop: 8 }}>
                  已选 {selectedRowKeys.length} 题
                </div>
              )}
            </div>
            <Divider orientation="left" style={{ fontSize: 12 }}>模型</Divider>
            <div className="knowledge-tree">
              <Tree
                treeData={modelTreeData}
                defaultExpandAll
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
      <Col span={treeVisible ? 19 : 24}>
        <Card style={{ margin: 0 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Space>
              {!treeVisible && (
                <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开知识点/模型</Button>
              )}
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

          {/* Filters - New layout */}
          <div style={{ marginBottom: 16 }}>
            {/* Row 1: 题型（单独一行）*/}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>题型：</span>
              <Checkbox.Group
                options={LIMIT_TYPES}
                value={filterTypes}
                onChange={(vals) => setFilterTypes(normalizeCheckGroup(vals as string[]))}
              />
            </div>

            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>难度：</span>
                <Checkbox.Group
                  options={LIMIT_DIFFICULTIES}
                  value={filterDifficulties}
                  onChange={(vals) => setFilterDifficulties(normalizeCheckGroup(vals as string[]))}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>状态：</span>
                <Checkbox.Group
                  options={LIMIT_STATUSES}
                  value={filterStatuses}
                  onChange={(vals) => setFilterStatuses(normalizeCheckGroup(vals as string[]))}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>媒介：</span>
                <Checkbox.Group
                  options={MEDIA_FILTERS}
                  value={filterMedia}
                  onChange={(vals) => setFilterMedia(normalizeCheckGroup(vals as string[]))}
                />
              </div>
            </div>

            {/* Row 2: 年级（单独一行）*/}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>年级：</span>
              <Checkbox.Group
                options={LIMIT_GRADES}
                value={filterGrades}
                onChange={(vals) => {
                  setFilterGrades(normalizeCheckGroup(vals as string[]));
                }}
              />
            </div>

            {/* Row 3: 学期（右）+ 学年 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>学期：</span>
                <Checkbox.Group
                  options={LIMIT_SEMESTERS}
                  value={filterSemesters}
                  onChange={(vals) => {
                    setFilterSemesters(normalizeCheckGroup(vals as string[]));
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>学年：</span>
                <Select
                  allowClear
                  style={{ width: 160 }}
                  placeholder="选择学年"
                  value={filterYear}
                  onChange={setFilterYear}
                  options={YEAR_OPTIONS}
                />
              </div>
            </div>

            {/* Row 4: 科目 | 考试类型 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>科目：</span>
                <Checkbox.Group
                  options={SUBJECTS}
                  value={filterSubjects}
                  onChange={(vals) => setFilterSubjects(vals as string[])}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>考试类型：</span>
                <Checkbox.Group
                  options={LIMIT_EXAM_TYPES}
                  value={filterExamTypes}
                  onChange={(vals) => {
                    setFilterExamTypes(normalizeCheckGroup(vals as string[]));
                  }}
                />
              </div>
            </div>

            {/* Row 5: 搜索题干 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input
                placeholder="搜索题干/答案/解析/知识点/模型/来源，空格分隔"
                allowClear
                style={{ width: 280 }}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onPressEnter={handleSearch}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
            </div>

            {/* Row 6: 知识点多选 */}
            <div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>知识点：</span>
                {knowledgeSelectedIds.map((selectedId, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="搜索知识点..."
                      style={{ width: 200 }}
                      value={selectedId}
                      onChange={(value) => {
                        const newIds = [...knowledgeSelectedIds];
                        newIds[idx] = value;
                        setKnowledgeSelectedIds(newIds);
                      }}
                      filterOption={(input, option) =>
                        (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                      }
                      onSearch={() => {}}
                      options={knowledgeNodes.map(n => ({ label: n.name, value: n.id }))}
                    />
                    {idx === knowledgeSelectedIds.length - 1 && (
                      <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setKnowledgeSelectedIds([...knowledgeSelectedIds, undefined])}
                        style={{ padding: '0 4px', minWidth: 20, height: 22 }}
                      />
                    )}
                    {knowledgeSelectedIds.length > 1 && (
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<CloseCircleOutlined />}
                        onClick={() => {
                          const newIds = knowledgeSelectedIds.filter((_, i) => i !== idx);
                          setKnowledgeSelectedIds(newIds);
                        }}
                        style={{ padding: '0 4px', minWidth: 20, height: 22 }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {activeKnowledgeIds.length > 0 && (
                <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
                  已选 {activeKnowledgeIds.length} 个知识点（AND 筛选），共覆盖 {expandedIncludeGroups.flat().length} 个后代节点
                </div>
              )}
            </div>

            {/* Row 7: 排除知识点 */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#ff4d4f', whiteSpace: 'nowrap' }}>排除：</span>
                {filterExcludeKnowledgeIds.map((eid, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="排除知识点..."
                      style={{ width: 200 }}
                      value={eid}
                      onChange={(value) => {
                        const newIds = [...filterExcludeKnowledgeIds];
                        newIds[idx] = value;
                        const filtered = newIds.filter(id => !!id);
                        setFilterExcludeKnowledgeIds(filtered.length === 0 ? [undefined] : filtered);
                        if (value) {
                          setKnowledgeSelectedIds(prev => prev.filter(id => id !== value));
                        }
                      }}
                      filterOption={(input, option) =>
                        (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                      }
                      options={knowledgeNodes.map(n => ({ label: n.name, value: n.id }))}
                    />
                    {idx === filterExcludeKnowledgeIds.length - 1 && (
                      <Button type="link" size="small" icon={<PlusOutlined />}
                        onClick={() => setFilterExcludeKnowledgeIds([...filterExcludeKnowledgeIds.filter(id => !!id), undefined])}
                        style={{ padding: '0 4px', minWidth: 20, height: 22 }}
                      />
                    )}
                    {filterExcludeKnowledgeIds.length > 1 && (
                      <Button type="link" size="small" danger icon={<CloseCircleOutlined />}
                        onClick={() => {
                          const newIds = filterExcludeKnowledgeIds.filter((_, i) => i !== idx);
                          setFilterExcludeKnowledgeIds(newIds.length === 0 ? [undefined] : newIds);
                        }}
                        style={{ padding: '0 4px', minWidth: 20, height: 22 }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Row 8: 模型多选 */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>模型：</span>
                {modelSelectedIds.map((selectedId, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="搜索模型..."
                      style={{ width: 200 }}
                      value={selectedId}
                      onChange={(value) => {
                        const newIds = [...modelSelectedIds];
                        newIds[idx] = value;
                        setModelSelectedIds(newIds);
                      }}
                      filterOption={(input, option) =>
                        (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                      }
                      options={modelNodes.map(n => ({ label: n.name, value: n.id }))}
                    />
                    {idx === modelSelectedIds.length - 1 && (
                      <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setModelSelectedIds([...modelSelectedIds, undefined])}
                        style={{ padding: '0 4px', minWidth: 20, height: 22 }}
                      />
                    )}
                    {modelSelectedIds.length > 1 && (
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<CloseCircleOutlined />}
                        onClick={() => {
                          const newIds = modelSelectedIds.filter((_, i) => i !== idx);
                          setModelSelectedIds(newIds.length === 0 ? [undefined] : newIds);
                        }}
                        style={{ padding: '0 4px', minWidth: 20, height: 22 }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {activeModelIds.length > 0 && (
                <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
                  已选 {activeModelIds.length} 个模型（AND 筛选），共覆盖 {expandedModelGroups.flat().length} 个后代节点
                </div>
              )}
            </div>
          </div>

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.length === 0 ? <Empty description="暂无试题" /> : filtered.map((q, idx) => {
              const inBasket = basketIds.includes(q.id);
              const sourceText = [q.source, q.year, q.region, q.school, q.exam_type].filter(Boolean).join(' / ') || '来源未标注';
              return (
                <div key={q.id} style={{ border: '1px solid #edf0f5', borderRadius: 6, padding: 12, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <Space size={6} wrap style={{ marginBottom: 6 }}>
                        <Tag color="blue">{q.subject || '物理'}</Tag>
                        <Tag>{q.type || '题型未标注'}</Tag>
                        <Tag>{q.exam_type || '其他'}</Tag>
                        <Tag>{q.status || 'draft'}</Tag>
                        {q.has_image && <Tag color="cyan">图片</Tag>}
                        {q.has_formula && <Tag color="purple">公式</Tag>}
                      </Space>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{idx + 1}. {highlightText(q.content, searchTerms)}</div>
                      {q.answer && <div style={{ marginTop: 8, color: '#555' }}>答案：{highlightText(q.answer, searchTerms)}</div>}
                      {q.analysis && <div style={{ marginTop: 8, color: '#666' }}>解析：{highlightText(q.analysis, searchTerms)}</div>}
                      <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
                        知识点：{highlightText((q.knowledge_ids || []).map(getNodeName).join('、') || q.knowledge_point || '未标注', searchTerms)}
                      </div>
                      <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
                        模型：{highlightText((q.model_ids || []).map(getModelName).join('、') || q.model_point || '未标注', searchTerms)}
                      </div>
                      <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>试题来源：{highlightText(sourceText, searchTerms)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <Button type="link" style={{ color: '#1677ff', padding: 0 }} onClick={() => openEditModal(q)}>编辑</Button>
                    <Button
                      type={inBasket ? 'default' : 'primary'}
                      icon={<ShoppingCartOutlined />}
                      style={inBasket ? { color: '#1677ff', borderColor: '#1677ff', background: '#fff' } : { background: '#1677ff', border: 'none' }}
                      onClick={() => toggleQuestionBasket(q.id)}
                    >
                      {inBasket ? '移出试题篮' : '加入试题篮'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </Col>

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
            <TextArea rows={4} placeholder="支持公式显示（用 $$ 包裹）" />
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
        </Form>
      </Modal>
    </Row>
  );
};

export default QuestionBankPreview;


