import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Modal, Form, Input, InputNumber, Select as AntSelect, Space, Tag, message,
  Tree, Divider, Checkbox, Empty, Row, Col, Typography, Table, Tooltip
} from 'antd';
import {
  PlusOutlined, FileWordOutlined, BookOutlined, FormOutlined,
  FileAddOutlined, CheckCircleOutlined, BranchesOutlined, FolderOpenOutlined,
  DeleteOutlined, EditOutlined, CloseCircleOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';

const { TextArea } = Input;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const QUESTION_TYPES = ['选择题', '填空题', '解答题', '判断题', '简答题', '实验题', '多选题', '作图题'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试'];
const GRADES = ['高一', '高二', '高三', '复习'];
const SEMESTERS = ['上学期', '下学期'];

const API_BASE = '/api/question-bank';

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
    content: row.content ?? row.stem ?? '',
    options: Array.isArray(options) ? options : [],
    analysis: row.analysis ?? row.explanation ?? '',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
  } as Question;
}

function toServerQuestion(q: any, meta: any = {}) {
  const questionTypes = q.question_types || ['fill'];
  return {
    subject_id: q.subject_id || null,
    chapter_id: q.chapter_id || null,
    type: questionTypes.includes('single') ? 'single' :
      questionTypes.includes('multi') ? 'multi' :
        questionTypes.includes('experiment') ? 'experiment' :
          questionTypes.includes('calculation') || questionTypes.includes('problem') ? 'problem' : 'fill',
    difficulty: q.difficulty || 3,
    stem: q.stem || q.content || '',
    options: q.options || [],
    answer: q.answer || '',
    explanation: q.explanation || q.analysis || '',
    source: q.source || '',
    year: q.year || meta.year || '',
    grade: q.grade || meta.grade || '',
    semester: q.semester || meta.semester || '',
    exam_type: q.exam_type || meta.exam_type || '',
    region: q.region || '',
    knowledge_point_ids: q.knowledge_point_ids || q.knowledge_ids || [],
    knowledge_points: q.knowledge_points || (q.knowledge_point ? [q.knowledge_point] : []),
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
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeName, setEditingNodeName] = useState('');
  const [addingChildParentId, setAddingChildParentId] = useState<string | null | '__ROOT__'>(null);
  const [addingChildName, setAddingChildName] = useState('');
  const [contextMenuNode, setContextMenuNode] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<{ id: string; name: string } | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
  const [wordModalVisible, setWordModalVisible] = useState(false);
  const [wordImporting, setWordImporting] = useState(false);
  const [wordResult, setWordResult] = useState<any>(null);
  const [importBatch, setImportBatch] = useState<ImportBatch | null>(null);
  const [committingBatch, setCommittingBatch] = useState(false);
  const [wordSourceType, setWordSourceType] = useState<'lecture' | 'exam'>('lecture');
  const [wordModalOpen, setWordModalOpen] = useState(false);
  const [examForm] = Form.useForm();
  const [form] = Form.useForm();
  const examMetaRef = useRef<any>(null);

  const loadData = useCallback(() => {
    try {
      const db = (window as any).dbService;
      if (!db) return;
      setQuestions((db.getAllQuestions?.() || []).map(normalizeQuestion));
      const kn = db.getKnowledgeTree?.() || [];
      setKnowledgeNodes(kn);
      if (kn.length === 0) {
        db.initDefaultKnowledgeTree?.();
        setKnowledgeNodes(db.getKnowledgeTree?.() || []);
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

  const handleSave = async () => {
    const values = await form.validateFields();
    const db = (window as any).dbService;

    const knowledge_ids: string[] = [];
    if (values.knowledge_ids) {
      Object.entries(values.knowledge_ids).forEach(([id, checked]) => {
        if (checked) knowledge_ids.push(id);
      });
    }

    const data: any = {
      subject: values.subject,
      type: values.type,
      difficulty: values.difficulty,
      content: values.content,
      options: values.options ? values.options.split('\n').filter((s: string) => s.trim()) : [],
      answer: values.answer,
      analysis: values.analysis,
      knowledge_ids,
      knowledge_point: values.knowledge_point || '',
      formulas: values.formulas ? values.formulas.split('\n').filter((s: string) => s.trim()) : [],
      tags: values.tags ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      source: values.source || '',
      year: values.year || '',
      grade: values.grade || '',
      semester: values.semester || '',
      exam_type: values.exam_type || '',
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

  const handleWordFileUpload = async (file: File, examMeta?: { year: string; exam_type: string; grade: string; semester: string }) => {
    // Store examMeta for later use in importWordResults
    examMetaRef.current = examMeta || null;
    setWordImporting(true);
    setWordResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source_type', wordSourceType);
      if (examMeta) {
        formData.append('year', examMeta.year);
        formData.append('exam_type', examMeta.exam_type);
        formData.append('grade', examMeta.grade);
        formData.append('semester', examMeta.semester);
      }

      const res = await fetch('https://physicsedu.xyz/question-bank/parse-word', {
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

  const commitImportBatch = async () => {
    if (!importBatch) return;
    setCommittingBatch(true);
    try {
      const res = await fetch(`${API_BASE}/imports/${importBatch.id}/commit`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'commit failed');
      const nextBatch = data.data || data;
      setImportBatch(nextBatch);
      setWordModalVisible(false);
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
          type: (q.question_types || ['fill']).includes('single') ? '选择题' :
                (q.question_types || ['fill']).includes('multi') ? '多选题' :
                (q.question_types || ['fill']).includes('experiment') ? '实验题' :
                (q.question_types || ['fill']).includes('calculation') ? '解答题' :
                (q.question_types || ['fill']).includes('problem') ? '解答题' : '填空题',
          difficulty: 3,
          content: q.stem || '',
          options: (q.options || []).map((o: any) => `${o.label}. ${o.content}`),
          answer: q.answer || '',
          analysis: q.analysis || '',
          source: q.source || '',
          year: q.year || meta.year || '',
          grade: q.grade || meta.grade || '',
          semester: q.semester || meta.semester || '',
          exam_type: q.exam_type || meta.exam_type || '',
          region: q.region || '',
          tags: [],
          formulas: [],
          knowledge_point: q.knowledge_point || '',
          knowledge_ids,
        });
        added++;
      } catch (e) { /* skip bad ones */ }
    }
    setWordModalVisible(false);
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
            title={<span><BranchesOutlined /> 知识树</span>}
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
            </div>
          </Card>
        </Col>
      )}

      {/* Main Content */}
      <Col span={treeVisible ? 19 : 24}>
        <Card style={{ margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Space>
              <h2 style={{ margin: 0 }}>📥 题目导入</h2>
              {!treeVisible && (
                <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开知识树</Button>
              )}
            </Space>
            <Space>
              <Button type="primary" icon={<BookOutlined />} onClick={() => {
                setWordSourceType('lecture');
                setWordModalVisible(true);
              }}>
                讲义格式导入
              </Button>
              <Button icon={<FormOutlined />} onClick={() => {
                setWordSourceType('exam');
                setWordModalOpen(true);
              }}>
                试卷格式导入
              </Button>
              <Button icon={<PlusOutlined />} onClick={() => {
                setEditing(null); form.resetFields();
                form.setFieldsValue({ subject: '物理', type: '选择题', difficulty: 3 });
                setModalVisible(true);
              }}>
                手动添加
              </Button>
            </Space>
          </div>

          <div style={{ background: '#f0f5ff', padding: '16px 20px', borderRadius: 8, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>📖 导入说明</h4>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#666', lineHeight: 1.8 }}>
              <li><b>讲义格式</b>：题目包含题号+题干+选项，批注式答案在题号旁标注（如【答案】B）</li>
              <li><b>试卷格式</b>：前半部分为题目区域（不含答案），后半部分为参考答案区域</li>
              <li>支持 <b>.doc / .docx</b> 格式的 Word 文档</li>
              <li>导入后可在「<b>试题预览</b>」页面查看和管理</li>
            </ul>
          </div>

          <div style={{ textAlign: 'center', padding: '60px 20px', border: '2px dashed #d9d9d9', borderRadius: 8, background: '#fafafa' }}>
            <FileWordOutlined style={{ fontSize: 64, color: '#1890ff' }} />
            <h3 style={{ marginTop: 16 }}>拖拽或点击选择 Word 文档</h3>
            <p style={{ color: '#999' }}>支持 .doc / .docx 讲义和试卷格式</p>
            <Button
              type="primary"
              size="large"
              icon={<FileWordOutlined />}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.doc,.docx';
                input.onchange = (e: any) => {
                  if (e.target.files?.[0]) {
                    const file = e.target.files[0];
                    // 先选择源类型
                    Modal.confirm({
                      title: '选择文档格式',
                      content: (
                        <Select value={wordSourceType} onChange={setWordSourceType} style={{ width: '100%', marginTop: 8 }}>
                          <Select.Option value="lecture"><BookOutlined /> 讲义（批注式答案）</Select.Option>
                          <Select.Option value="exam"><FormOutlined /> 试卷（参考答案分离式）</Select.Option>
                        </Select>
                      ),
                      onOk: () => handleWordFileUpload(file),
                    });
                  }
                };
                input.click();
              }}
            >
              选择文件
            </Button>
          </div>

          {/* 最近导入记录 */}
          {questions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Divider orientation="left">最近导入</Divider>
              <div style={{ color: '#666', fontSize: 13 }}>
                题库中共有 <b>{questions.length}</b> 道题目，来自多次导入操作。
                <Button type="link" onClick={() => setWordModalVisible(true)}>继续导入</Button>
              </div>
            </div>
          )}
        </Card>
      </Col>

      {/* 试卷格式导入 — 需填写试卷元信息 */}
      <Modal
        title={<span><FormOutlined /> 试卷格式导入 — 填写试卷信息</span>}
        open={wordModalOpen}
        onCancel={() => { setWordModalOpen(false); examForm.resetFields(); }}
        onOk={async () => {
          const values = await examForm.validateFields();
          const input = document.createElement('input');
          input.type = 'file'; input.accept = '.doc,.docx';
          input.onchange = (e: any) => {
            if (e.target.files?.[0]) {
              setWordModalOpen(false);
              setWordSourceType('exam');
              handleWordFileUpload(e.target.files[0], {
                year: values.year,
                exam_type: values.exam_type,
                grade: values.grade,
                semester: values.semester
              });
            }
          };
          input.click();
        }}
        okText="选择 Word 文件"
        width={500}
        destroyOnClose
      >
        <p style={{ color: '#666', marginBottom: 16 }}>试卷格式文档需要填写以下试卷元信息，将自动关联到导入的题目。</p>
        <Form form={examForm} layout="vertical" initialValues={{ year: new Date().getFullYear().toString() }}>
          <Form.Item name="year" label="年份" rules={[{ required: true, message: '请选择年份' }]}>
            <Select>
              {Array.from({ length: 6 }, (_, i) => (new Date().getFullYear() - 5 + i).toString()).map(y => (
                <Select.Option key={y} value={y}>{y}年</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="exam_type" label="试卷类型" rules={[{ required: true, message: '请选择试卷类型' }]}>
            <Select options={EXAM_TYPES.map(t => ({ label: t, value: t }))} />
          </Form.Item>
          <Form.Item name="grade" label="年级" rules={[{ required: true, message: '请选择年级' }]}>
            <Select options={GRADES.map(g => ({ label: g, value: g }))} />
          </Form.Item>
          <Form.Item name="semester" label="学期" rules={[{ required: true, message: '请选择学期' }]}>
            <Select options={SEMESTERS.map(s => ({ label: s, value: s }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Word Import Modal */}
      <Modal
        title={<span><FileWordOutlined /> 从Word文档批量导入题目</span>}
        open={wordModalVisible}
        onCancel={() => { setWordModalVisible(false); setWordResult(null); }}
        footer={null}
        width={700}
        destroyOnClose
      >
        <p style={{ color: '#666', marginBottom: 16 }}>
          支持自动识别 Word 文档中的题目，兼容<b>讲义</b>（批注式答案）和<b>试卷</b>（参考答案分离式）两种格式。
        </p>

        <div style={{ marginBottom: 16 }}>
          <Space>
            <span>文档格式：</span>
            <Select value={wordSourceType} onChange={setWordSourceType} style={{ width: 150 }}>
              <Select.Option value="lecture"><BookOutlined /> 讲义（批注式答案）</Select.Option>
              <Select.Option value="exam"><FormOutlined /> 试卷（参考答案分离式）</Select.Option>
            </Select>
            <Tag>{wordSourceType === 'lecture' ? '题号+选项+批注答案' : '前半部分题目+后半部分答案'}</Tag>
          </Space>
        </div>

        <div
          style={{
            border: '2px dashed #d9d9d9', borderRadius: 8, padding: 40, textAlign: 'center',
            cursor: 'pointer', background: '#fafafa', marginBottom: 16
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) handleWordFileUpload(file);
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.doc,.docx'; input.onchange = (e: any) => {
              if (e.target.files?.[0]) handleWordFileUpload(e.target.files[0]);
            };
            input.click();
          }}
        >
          <FileWordOutlined style={{ fontSize: 48, color: '#1890ff' }} />
          <p style={{ marginTop: 12, color: '#666' }}>点击或拖拽 Word 文档到此处</p>
          <p style={{ fontSize: 12, color: '#999' }}>支持 .doc / .docx 格式</p>
        </div>

        {wordImporting && <div style={{ textAlign: 'center', padding: 20 }}>解析中...</div>}

        {wordResult && (
          <div>
            <div style={{ marginBottom: 12, background: '#f6ffed', padding: '8px 12px', borderRadius: 6 }}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />{' '}
              成功解析 <b>{wordResult.count}</b> 道题目
              {wordResult.topics?.length > 0 && `，${wordResult.topics.length} 个专题`}
            </div>
            <Table
              columns={[
                { title: '#', dataIndex: 'id', key: 'id', width: 60, render: (_: any, __: any, i: number) => i + 1 },
                { title: '题干', dataIndex: 'stem', key: 'stem', ellipsis: true },
                { title: '题型', dataIndex: 'question_types', key: 'types', width: 100, render: (ts: string[]) => (ts || []).join(', ') },
                { title: '答案', dataIndex: 'answer', key: 'answer', width: 100, ellipsis: true },
              ]}
              dataSource={wordResult.questions || []}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ y: 200 }}
            />
            {importBatch && (
              <div style={{ marginTop: 12, background: '#fff7e6', padding: '8px 12px', borderRadius: 6 }}>
                <Space wrap>
                  <Tag color="blue">批次 {importBatch.status}</Tag>
                  <Tag color="green">可入库 {importBatch.accepted_items}</Tag>
                  <Tag color="orange">重复 {importBatch.duplicate_items}</Tag>
                  <Tag color="red">拒绝 {importBatch.rejected_items}</Tag>
                  <Text type="secondary">
                    质量：高 {importBatch.quality_report?.quality_buckets?.high || 0} / 中 {importBatch.quality_report?.quality_buckets?.medium || 0} / 低 {importBatch.quality_report?.quality_buckets?.low || 0}
                  </Text>
                </Space>
              </div>
            )}
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" icon={<FileAddOutlined />} loading={committingBatch} onClick={() => importWordResults(wordResult)}>
                入库 {importBatch ? importBatch.accepted_items : wordResult.count} 道题
              </Button>
              <Button onClick={() => { setWordResult(null); setImportBatch(null); }}>重新选择文件</Button>
            </Space>
          </div>
        )}
      </Modal>

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
              {knowledgeNodes.length > 0 ? renderKnowledgeCheckboxes(knowledgeNodes) : <Empty description="暂无知识树数据" />}
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
};

export default QuestionBankImport;
