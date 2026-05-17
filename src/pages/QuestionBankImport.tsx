import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Modal, Form, Input, InputNumber, Select as AntSelect, Space, Tag, message,
  Tree, Divider, Checkbox, Empty, Row, Col, Typography, Table, Tooltip, Radio
} from 'antd';
import {
  PlusOutlined, FileWordOutlined, BookOutlined, FormOutlined,
  FileAddOutlined, CheckCircleOutlined, BranchesOutlined, FolderOpenOutlined,
  DeleteOutlined, EditOutlined, CloseCircleOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { getApiBase } from '../utils/apiBase';
import { QUESTION_TYPES, normalizeQuestionType, questionTypeFromParser } from '../constants/questionTypes';

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
  duplicate_items: number;
  rejected_items: number;
  quality_report?: any;
  commit_result?: any;
};

type ExamMeta = {
  year?: string;
  exam_type?: string;
  grade?: string;
  semester?: string;
  region?: string;
  school?: string;
  paper_name?: string;
};

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function extractExamMetaFromFileName(fileName: string): ExamMeta {
  const name = stripFileExtension(fileName);
  const meta: ExamMeta = { paper_name: name };
  const yearMatch = name.match(/(19\d{2}|20\d{2})/);
  if (yearMatch) meta.year = yearMatch[1];

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

  const schoolMatch = name.match(/([\u4e00-\u9fa5]{2,24}(?:中学|高中|学校|外国语|实验学校|教育集团|十校联盟|联盟))/);
  if (schoolMatch) meta.school = schoolMatch[1];

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
    exam_type: q.exam_type || meta.exam_type || '其他',
    region: q.region || meta.region || '',
    school: q.school || meta.school || '',
    paper_name: q.paper_name || meta.paper_name || '',
    status: q.status || 'draft',
    has_image: !!q.has_image,
    has_formula: !!q.has_formula,
    created_by: q.created_by || '',
    knowledge_point_ids: q.knowledge_point_ids || q.knowledge_ids || [],
    knowledge_points: q.knowledge_points || (q.knowledge_point ? [q.knowledge_point] : []),
    model_point_ids: q.model_point_ids || q.model_ids || [],
    model_points: q.model_points || (q.model_point ? [q.model_point] : []),
  };
}

function normalizeImportedKnowledgeIds(db: any, parsedQuestion: any): string[] {
  const names = parsedQuestion.knowledge_points || (parsedQuestion.knowledge_point ? [parsedQuestion.knowledge_point] : []);
  const knowledgeTree = db.getKnowledgeTree?.() || [];
  const ids = new Set<string>((parsedQuestion.knowledge_ids || parsedQuestion.knowledge_point_ids || []).filter(Boolean));
  for (const name of names || []) {
    const text = String(name || '').trim();
    if (!text) continue;
    let node = knowledgeTree.find((n: any) => n.name === text);
    if (!node && db.createKnowledgeNode) {
      node = db.createKnowledgeNode({ name: text, parent_id: null });
      knowledgeTree.push(node);
    }
    if (node?.id) ids.add(node.id);
  }
  return [...ids];
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
    } catch (e) {
      console.error('QuestionBankImport loadData error:', e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
  }, [editingNodeId, editingNodeName, addingChildParentId, addingChildName, handleRenameKnowledgeNode, handleCreateKnowledgeNode]);

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
        setWordResult(data);
        setImportBatch(null);
        try {
          const checkRes = await fetch(`${API_BASE}/imports/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_type: wordSourceType,
              file_name: file.name,
              items: (data.questions || []).map((q: any) => toServerQuestion(q, examMeta || {})),
            }),
          });
          const batchData = await checkRes.json();
          if (batchData.success) {
            setImportBatch(batchData.data || batchData);
          } else {
            message.warning(batchData.error || '导入批次校验未完成');
          }
        } catch (checkError: any) {
          message.warning('导入批次校验失败: ' + (checkError.message || 'unknown error'));
        }
        message.success(`成功解析 ${data.count || 0} 道题目`);
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
      setImportBatch(nextBatch);
      setWordResult(null);
      loadData();
      message.success(`已入库 ${nextBatch.commit_result?.imported_items || 0} 道题，索引任务已创建`);
    } catch (e: any) {
      message.error('提交导入批次失败: ' + (e.message || 'unknown error'));
    } finally {
      setCommittingBatch(false);
    }
  };

  const importWordResults = (result: any) => {
    if (importBatch) {
      commitImportBatch();
      return;
    }
    const db = (window as any).dbService;
    if (!db) { message.error('数据库未就绪'); return; }
    // Read stored examMeta for auto-labeling
    const meta = examMetaRef.current || {};
    let added = 0;
    for (const q of (result.questions || [])) {
      try {
        const knowledge_ids = normalizeImportedKnowledgeIds(db, q);
        db.createQuestion({
          subject: '物理',
          type: questionTypeFromParser(q.question_types),
          difficulty: 3,
          content: q.stem || '',
          options: (q.options || []).map((o: any) => `${o.label}. ${o.content}`),
          answer: q.answer || '',
          analysis: q.analysis || '',
          source: q.source || '',
          year: q.year || meta.year || '',
          grade: q.grade || meta.grade || '',
          semester: q.semester || meta.semester || '',
          exam_type: q.exam_type || meta.exam_type || '其他',
          region: q.region || meta.region || '',
          school: q.school || meta.school || '',
          edit_status: '未编辑',
          status: q.status || 'draft',
          has_image: !!q.has_image,
          has_formula: !!q.has_formula,
          created_by: q.created_by || '',
          tags: [],
          formulas: [],
          knowledge_point: q.knowledge_point || '',
          knowledge_ids,
          model_ids: [],
        });
        added++;
      } catch (e) { /* skip bad ones */ }
    }
    setWordResult(null);
    loadData();
    message.success(`成功导入 ${added}/${result.count} 道题目到本地题库`);
  };

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
              defaultExpandAll draggable onDrop={handleTreeDrop}
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
            <Divider />
            <div style={{ color: '#666', fontSize: 12 }}>
              <div>题目总数：{questions.length}</div>
              <div>知识点：{knowledgeNodes.length}</div>
              <div>模型：{modelNodes.length}</div>
            </div>
            <Divider orientation="left" style={{ fontSize: 12 }}>模型</Divider>
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
                defaultExpandAll
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

          <div style={{ background: '#f7f9fc', border: '1px solid #e8edf3', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <Row gutter={[20, 16]} align="top">
              <Col xs={24} lg={9}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileWordOutlined style={{ fontSize: 22, color: '#1890ff' }} />
                    <Text strong>导入格式与说明</Text>
                  </div>
                  <Radio.Group value={wordSourceType} onChange={e => setWordSourceType(e.target.value)} buttonStyle="solid">
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
                <Form form={examForm} layout="vertical" disabled={wordSourceType !== 'exam'} initialValues={{ year: new Date().getFullYear().toString() }}>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name="year" label="年份"><Select options={Array.from({ length: 10 }, (_, i) => (new Date().getFullYear() - 7 + i).toString()).map(y => ({ value: y, label: y + '年' }))} /></Form.Item></Col>
                    <Col span={8}><Form.Item name="exam_type" label="考试类型"><Select options={EXAM_TYPES.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
                    <Col span={8}><Form.Item name="grade" label="年级"><Select options={GRADES.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name="semester" label="学期"><Select options={SEMESTERS.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
                    <Col span={8}><Form.Item name="region" label="地区"><Input placeholder="如：浙江" /></Form.Item></Col>
                    <Col span={8}><Form.Item name="school" label="学校"><Input placeholder="如：杭州某中学" /></Form.Item></Col>
                  </Row>
                  <Form.Item name="paper_name" label="试卷名"><Input placeholder="选择文件后自动填入文件名，也可手动修改" /></Form.Item>
                </Form>
              </Col>
            </Row>
          </div>

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
                disabled={!selectedWordFile}
                onClick={handleStartParse}
              >
                开始解析
              </Button>
            </Space>
          </div>

          {/* 最近导入记录 */}
          {questions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Divider orientation="left">最近导入</Divider>
              <div style={{ color: '#666', fontSize: 13 }}>
                题库中共有 <b>{questions.length}</b> 道题目，来自多次导入操作。
              </div>
            </div>
          )}
        </Card>
      </Col>

      {/* 试卷格式导入 — 需填写试卷元信息 */}

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
              <Form.Item name="grade" label="年级">
                <Select allowClear>{GRADES.map(g => <Select.Option key={g} value={g}>{g}</Select.Option>)}</Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="year" label="年份"><Input placeholder="2026" /></Form.Item>
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
