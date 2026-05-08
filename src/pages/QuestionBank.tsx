import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag, message,
  Popconfirm, Tooltip, Tree, Divider, Badge, Checkbox, Dropdown, Menu, Empty, Typography
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, CopyOutlined,
  FolderOpenOutlined, TagsOutlined, ExportOutlined, FileAddOutlined, BranchesOutlined,
  CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, UploadOutlined,
  AimOutlined, FileWordOutlined, BookOutlined, FormOutlined, MoreOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode } from '../types';

const { TextArea } = Input;
const { Text } = Typography;

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const QUESTION_TYPES = ['选择题', '填空题', '解答题', '判断题', '简答题', '实验题', '多选题', '作图题'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试'];
const GRADES = ['高一', '高二', '高三', '复习'];
const SEMESTERS = ['上学期', '下学期'];

const dbService = (): any => (window as any).dbService;

/**
 * 在 treeData 中构建带按钮的标题 ReactNode。
 * 把添加、编辑、删除按钮直接放进 title 字段，避免依赖 titleRender。
 */
function buildNodeTitle(
  nodeName: string,
  nodeId: string,
  addingChildParentId: string | null | '__ROOT__',
  addingChildName: string,
  editingNodeId: string | null,
  editingNodeName: string,
  onAddChild: (parentId: string) => void,
  onEdit: (id: string, name: string) => void,
  onRename: (id: string, name: string) => void,
  onDelete: (id: string, name: string) => void,
  onCreateChild: (name: string, parentId: string) => void,
  onCancelChild: () => void,
  onSetEditingName: (name: string) => void,
  onSetAddingName: (name: string) => void,
  onCancelEdit: () => void,
): React.ReactNode {
  const isEditing = editingNodeId === nodeId;
  const isAdding = addingChildParentId === nodeId;

  return (
    <div style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, padding: '1px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {isEditing ? (
          <Input
            size="small"
            value={editingNodeName}
            onChange={e => onSetEditingName(e.target.value)}
            onBlur={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v.trim()) onRename(nodeId, v.trim());
              onCancelEdit();
            }}
            onPressEnter={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v.trim()) onRename(nodeId, v.trim());
              onCancelEdit();
            }}
            style={{ width: 120 }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <>
            <span style={{ flex: 1, userSelect: 'none', fontSize: 13 }}>{nodeName}</span>
            <Button
              type="link"
              size="small"
              icon={<PlusOutlined />}
              onClick={e => { e.stopPropagation(); onAddChild(nodeId); }}
              style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }}
            />
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={e => { e.stopPropagation(); onEdit(nodeId, nodeName); }}
              style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px' }}
            />
            <Popconfirm
              title={`确定删除知识点「${nodeName}」及其所有子节点？`}
              onConfirm={() => onDelete(nodeId, nodeName)}
              onCancel={() => {}}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={e => e.stopPropagation()}
                style={{ padding: 0, minWidth: 18, height: 18, fontSize: 11, lineHeight: '18px', color: '#ff4d4f' }}
              />
            </Popconfirm>
          </>
        )}
      </div>
      {isAdding && (
        <div style={{ paddingLeft: 20, marginTop: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Input
              size="small"
              placeholder="子知识点名称"
              value={addingChildName}
              onChange={e => onSetAddingName(e.target.value)}
              onBlur={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.trim()) onCreateChild(v.trim(), nodeId);
                onCancelChild();
              }}
              onPressEnter={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.trim()) onCreateChild(v.trim(), nodeId);
                onCancelChild();
              }}
              style={{ width: 140 }}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
            <Button
              type="link"
              size="small"
              icon={<CloseCircleOutlined />}
              onClick={e => { e.stopPropagation(); onCancelChild(); }}
              style={{ padding: 0, minWidth: 16, height: 16, fontSize: 11, color: '#999' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Build tree data for Ant Design Tree — title 字段直接包含按钮组件
function buildTreeData(
  nodes: KnowledgeNode[],
  parentId: string | undefined,
  state: {
    addingChildParentId: string | null | '__ROOT__';
    addingChildName: string;
    editingNodeId: string | null;
    editingNodeName: string;
  },
  handlers: {
    onAddChild: (parentId: string) => void;
    onEdit: (id: string, name: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string, name: string) => void;
    onCreateChild: (name: string, parentId: string) => void;
    onCancelChild: () => void;
    onSetEditingName: (name: string) => void;
    onSetAddingName: (name: string) => void;
    onCancelEdit: () => void;
  },
): any[] {
  return nodes
    .filter(n => n.parent_id === parentId || (!parentId && !n.parent_id))
    .sort((a, b) => a.order - b.order)
    .map(n => ({
      key: n.id,
      title: buildNodeTitle(
        n.name, n.id,
        state.addingChildParentId, state.addingChildName,
        state.editingNodeId, state.editingNodeName,
        handlers.onAddChild, handlers.onEdit,
        handlers.onRename, handlers.onDelete,
        handlers.onCreateChild, handlers.onCancelChild,
        handlers.onSetEditingName, handlers.onSetAddingName, handlers.onCancelEdit,
      ),
      children: buildTreeData(nodes, n.id, state, handlers),
      icon: <FolderOpenOutlined />,
    }));
}

const QuestionBank: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
  const [filterSubject, setFilterSubject] = useState<string | undefined>();
  const [filterType, setFilterType] = useState<string | undefined>();
  const [filterExamType, setFilterExamType] = useState<string | undefined>();
  const [filterKnowledge, setFilterKnowledge] = useState<string | undefined>();
  const [searchText, setSearchText] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
  const [wordModalVisible, setWordModalVisible] = useState(false);
  const [wordImporting, setWordImporting] = useState(false);
  const [wordResult, setWordResult] = useState<any>(null);
  const [wordSourceType, setWordSourceType] = useState<'lecture' | 'exam'>('lecture');
  const [form] = Form.useForm();

  // Inline tree CRUD state
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeName, setEditingNodeName] = useState('');
  const [addingChildParentId, setAddingChildParentId] = useState<string | null | '__ROOT__'>(null);
  const [addingChildName, setAddingChildName] = useState('');
  // 右键菜单
  const [contextMenuNode, setContextMenuNode] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  // 知识点多选过滤
  const [filterKnowledgeIds, setFilterKnowledgeIds] = useState<string[]>([]);

  const loadData = useCallback(() => {
    try {
      const db = (window as any).dbService;
      if (!db) return;
      setQuestions(db.getAllQuestions?.() || []);
      setKnowledgeNodes([...(db.getKnowledgeTree?.() || [])]);
      if (db.getKnowledgeTree?.().length === 0) {
        db.initDefaultKnowledgeTree?.();
        setKnowledgeNodes([...(db.getKnowledgeTree?.() || [])]);
      }
    } catch (e) {
      console.error('QuestionBank loadData error:', e);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Filters
  const filtered = questions.filter(q => {
    if (filterSubject && q.subject !== filterSubject) return false;
    if (filterType && q.type !== filterType) return false;
    if (filterExamType && q.exam_type !== filterExamType) return false;
    if (filterKnowledge && !(q.knowledge_ids || []).includes(filterKnowledge)) return false;
    if (filterKnowledgeIds.length > 0 && !(q.knowledge_ids || []).some(kid => filterKnowledgeIds.includes(kid))) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      // 检查题目内容/知识点名称/来源
      let match = q.content.toLowerCase().includes(s) ||
          (q.knowledge_point || '').toLowerCase().includes(s) ||
          (q.source || '').toLowerCase().includes(s);
      // 同时也搜索知识树中的节点名称（模糊搜索）
      if (!match && (q.knowledge_ids || []).length > 0) {
        match = (q.knowledge_ids || []).some(kid => {
          const kn = knowledgeNodes.find(n => n.id === kid);
          return kn && kn.name.toLowerCase().includes(s);
        });
      }
      if (!match) return false;
    }
    return true;
  }).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  const handleSave = async () => {
    const values = await form.validateFields();
    const db = (window as any).dbService;

    // Collect knowledge_ids from checkboxes
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

  const handleBatchKnowledge = (knowledgeId: string) => {
    const db = (window as any).dbService;
    selectedRowKeys.forEach(id => {
      const q = questions.find(x => x.id === id);
      if (q) {
        const ids = [...new Set([...(q.knowledge_ids || []), knowledgeId])];
        db.updateQuestion(id, { knowledge_ids: ids });
      }
    });
    loadData();
  };

  const difficultyColor = (d: number) => {
    if (d <= 2) return 'green';
    if (d <= 3) return 'orange';
    return 'red';
  };

  const getNodeName = (id: string) => {
    const n = knowledgeNodes.find(x => x.id === id);
    return n ? n.name : id;
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
    { title: '科目', dataIndex: 'subject', key: 'subject', width: 70, render: (s: string) => <Tag>{s}</Tag> },
    { title: '题型', dataIndex: 'type', key: 'type', width: 75 },
    {
      title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 65,
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
      title: '来源', key: 'source', width: 80,
      render: (_: any, r: Question) => r.exam_type ? <Tag>{r.exam_type}</Tag> : '-'
    },
    {
      title: '操作', key: 'action', width: 140,
      render: (_: any, r: Question) => (
        <Space size={0}>
          <Tooltip title="编辑"><Button type="link" size="small" icon={<EditOutlined />} onClick={() => {
            setEditing(r);
            // Build knowledge_ids form values
            const knForm: Record<string, boolean> = {};
            (r.knowledge_ids || []).forEach(id => { knForm[id] = true; });
            form.setFieldsValue({
              subject: r.subject, type: r.type, difficulty: r.difficulty,
              content: r.content, options: (r.options || []).join('\n'),
              answer: r.answer, analysis: r.analysis,
              knowledge_point: r.knowledge_point,
              knowledge_ids: knForm,
              formulas: (r.formulas || []).join('\n'),
              tags: (r.tags || []).join(','),
              source: r.source, year: r.year, grade: r.grade,
              semester: r.semester, exam_type: r.exam_type,
            });
            setModalVisible(true);
          }} /></Tooltip>
          <Tooltip title="创建变式"><Button type="link" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(r.id)} /></Tooltip>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Tooltip title="删除"><Button type="link" size="small" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      )
    },
  ];

  // Knowledge tree in modal
  const renderKnowledgeCheckboxes = (nodes: KnowledgeNode[], parentId?: string, depth = 0) => {
    const children = nodes.filter(n => n.parent_id === parentId || (!parentId && !n.parent_id)).sort((a, b) => a.order - b.order);
    if (children.length === 0) return null;
    return (
      <div style={{ marginLeft: depth * 20 }}>
        {children.map(n => (
          <div key={n.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <Form.Item name={['knowledge_ids', n.id]} valuePropName="checked" noStyle>
                <Checkbox onChange={() => {}} />
              </Form.Item>
              <span style={{ fontWeight: n.parent_id ? 'normal' : 600 }}>{n.name}</span>
            </div>
            {renderKnowledgeCheckboxes(nodes, n.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  const handleWordFileUpload = async (file: File) => {
    setWordImporting(true);
    setWordResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source_type', wordSourceType);

      const res = await fetch('https://physicsedu.xyz/question-bank/parse-word', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        message.error(data.error);
      } else {
        setWordResult(data);
        message.success(`成功解析 ${data.count || 0} 道题目`);
      }
    } catch (e: any) {
      message.error('导入失败: ' + (e.message || '网络请求失败'));
    }
    setWordImporting(false);
  };

  const importWordResults = (result: any) => {
    const db = (window as any).dbService;
    if (!db) { message.error('数据库未就绪'); return; }
    let added = 0;
    for (const q of (result.questions || [])) {
      try {
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
          year: q.year || '',
          grade: q.grade || '',
          exam_type: q.exam_type || '',
          region: q.region || '',
          tags: [],
          formulas: [],
          knowledge_point: '',
        });
        added++;
      } catch (e) { /* skip bad ones */ }
    }
    setWordModalVisible(false);
    setWordResult(null);
    loadData();
    message.success(`成功导入 ${added}/${result.count} 道题目到本地题库`);
  };

  // Tree CRUD handlers
  const handleCreateKnowledgeNode = (name: string, parentId?: string | null) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.createKnowledgeNode({ name, parent_id: parentId || null });
    setKnowledgeNodes([...(db.getKnowledgeTree?.() || [])]);
  };

  const handleRenameKnowledgeNode = (id: string, name: string) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.updateKnowledgeNode(id, { name });
    setKnowledgeNodes([...(db.getKnowledgeTree?.() || [])]);
  };

  const handleDeleteKnowledgeNode = (id: string) => {
    const db = (window as any).dbService;
    if (!db) return;
    db.deleteKnowledgeNode(id);
    setKnowledgeNodes([...(db.getKnowledgeTree?.() || [])]);
  };

  const handleTreeDrop = (info: any) => {
    const dragKey = info.dragNode.key as string;
    const dropKey = info.node.key as string;
    const dropToGap = info.dropToGap as boolean;

    if (dragKey === dropKey) return;

    let newParentId: string | null;
    if (dropToGap) {
      const dropNode = knowledgeNodes.find(n => n.id === dropKey);
      newParentId = dropNode?.parent_id || null;
    } else {
      newParentId = dropKey;
    }

    // Check for circular reference (prevent dropping a node onto its own descendant)
    const isDescendant = (nodeId: string, ancestorId: string): boolean => {
      const node = knowledgeNodes.find(n => n.id === nodeId);
      if (!node || !node.parent_id) return false;
      if (node.parent_id === ancestorId) return true;
      return isDescendant(node.parent_id, ancestorId);
    };

    if (isDescendant(dropKey, dragKey)) {
      message.warning('不能将知识点移动到其子节点下');
      return;
    }

    Modal.confirm({
      title: '确认移动',
      content: '确定将选中知识点及其所有子节点移动到此位置？',
      okText: '移动',
      cancelText: '取消',
      onOk: () => {
        const db = (window as any).dbService;
        if (!db) return;
        db.updateKnowledgeNode(dragKey, { parent_id: newParentId });
        setKnowledgeNodes([...(db.getKnowledgeTree?.() || [])]);
        message.success('知识点已移动');
      },
    });
  };

  // 组装 treeData，每个节点的 title 直接包含按钮
  const treeData = buildTreeData(knowledgeNodes, undefined, {
    addingChildParentId, addingChildName,
    editingNodeId, editingNodeName,
  }, {
    onAddChild: (pid: string) => { setAddingChildParentId(pid); setAddingChildName(''); },
    onEdit: (id: string, name: string) => { setEditingNodeId(id); setEditingNodeName(name); },
    onRename: handleRenameKnowledgeNode,
    onDelete: handleDeleteKnowledgeNode,
    onCreateChild: handleCreateKnowledgeNode,
    onCancelChild: () => { setAddingChildParentId(null); setAddingChildName(''); },
    onSetEditingName: setEditingNodeName,
    onSetAddingName: setAddingChildName,
    onCancelEdit: () => { setEditingNodeId(null); setEditingNodeName(''); },
  });

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
                <Input
                  size="small"
                  placeholder="根节点名称"
                  value={addingChildName}
                  onChange={e => setAddingChildName(e.target.value)}
                  onBlur={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v.trim()) {
                      handleCreateKnowledgeNode(v.trim(), null);
                    }
                    setAddingChildParentId(null);
                    setAddingChildName('');
                  }}
                  onPressEnter={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v.trim()) {
                      handleCreateKnowledgeNode(v.trim(), null);
                    }
                    setAddingChildParentId(null);
                    setAddingChildName('');
                  }}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <Button
                  type="link"
                  size="small"
                  icon={<CloseCircleOutlined />}
                  onClick={() => {
                    setAddingChildParentId(null);
                    setAddingChildName('');
                  }}
                  style={{ padding: 0, minWidth: 16, height: 16, color: '#999' }}
                />
              </div>
            ) : (
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  setAddingChildParentId('__ROOT__');
                  setAddingChildName('');
                }}
                style={{ marginBottom: 8, width: '100%' }}
              >
                新建根节点
              </Button>
            )}

            {/* 右键菜单：删除确认 */}
            <Modal
              open={!!contextMenuNode}
              title="操作知识点"
              onCancel={() => setContextMenuNode(null)}
              footer={null}
              width={240}
            >
              {contextMenuNode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ padding: '4px 0', color: '#666', fontSize: 13 }}>
                    <FolderOpenOutlined style={{ marginRight: 6 }} />{contextMenuNode.name}
                  </div>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setAddingChildParentId(contextMenuNode.id);
                      setAddingChildName('');
                      setContextMenuNode(null);
                    }}
                  >
                    添加子知识点
                  </Button>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditingNodeId(contextMenuNode.id);
                      setEditingNodeName(contextMenuNode.name);
                      setContextMenuNode(null);
                    }}
                  >
                    重命名
                  </Button>
                  <Popconfirm
                    title={`确定删除知识点「${contextMenuNode.name}」及其所有子节点？`}
                    onConfirm={() => {
                      handleDeleteKnowledgeNode(contextMenuNode.id);
                      setContextMenuNode(null);
                    }}
                    onCancel={() => setContextMenuNode(null)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button danger icon={<DeleteOutlined />}>删除知识点</Button>
                  </Popconfirm>
                </div>
              )}
            </Modal>

            <Tree
              showIcon
              treeData={treeData}
              defaultExpandAll
              draggable
              onDrop={handleTreeDrop}
              onRightClick={({ event, node }: any) => {
                event.preventDefault();
                const targetNode = knowledgeNodes.find(n => n.id === node.key);
                if (targetNode) {
                  setContextMenuNode({
                    id: targetNode.id,
                    name: targetNode.name,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }
              }}
              onSelect={(keys) => {
                setFilterKnowledge(keys[0] as string || undefined);
              }}
              style={{ fontSize: 13 }}
            />
            {filterKnowledge && (
              <Button type="link" size="small" onClick={() => setFilterKnowledge(undefined)} style={{ marginTop: 8 }}>
                清除筛选
              </Button>
            )}
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
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Space>
              <h2 style={{ margin: 0 }}>题库管理</h2>
              {!treeVisible && (
                <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开知识树</Button>
              )}
              <Badge count={filtered.length} style={{ backgroundColor: '#1890ff' }} overflowCount={9999} />
            </Space>
            <Space>
              <Button icon={<FileWordOutlined />} onClick={() => setWordModalVisible(true)}>从Word导入</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                setEditing(null); form.resetFields();
                form.setFieldsValue({ subject: '物理', type: '选择题', difficulty: 3 });
                setModalVisible(true);
              }}>添加题目</Button>
            </Space>
          </div>

          {/* Filters */}
          <div style={{ marginBottom: 12 }}>
            <Space wrap>
              <Select placeholder="科目" allowClear style={{ width: 110 }} value={filterSubject} onChange={setFilterSubject}>
                {SUBJECTS.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}
              </Select>
              <Select placeholder="题型" allowClear style={{ width: 110 }} value={filterType} onChange={setFilterType}>
                {QUESTION_TYPES.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
              </Select>
              <Select placeholder="考试类型" allowClear style={{ width: 130 }} value={filterExamType} onChange={setFilterExamType}>
                {EXAM_TYPES.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
              </Select>
              <Select
                mode="multiple"
                placeholder="知识点（多选）"
                allowClear
                style={{ width: 200 }}
                value={filterKnowledgeIds.length > 0 ? filterKnowledgeIds : undefined}
                onChange={(vals: string[]) => setFilterKnowledgeIds(vals || [])}
                filterOption={(input, option) =>
                  (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                }
                options={knowledgeNodes.map(n => ({ value: n.id, label: n.name }))}
              />
              <Input.Search
                placeholder="搜索题干/知识点..."
                allowClear
                style={{ width: 220 }}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </Space>
          </div>

          {/* Batch Operations */}
          {selectedRowKeys.length > 0 && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 6 }}>
              <Space>
                <CheckCircleOutlined style={{ color: '#1890ff' }} />
                <Text strong>已选 {selectedRowKeys.length} 题</Text>
                <Button size="small" onClick={handleBatchTag}><TagsOutlined /> 批量打标签</Button>
                <Dropdown overlay={
                  <Menu onClick={({ key }) => handleBatchKnowledge(key)}>
                    {knowledgeNodes.map(n => (
                      <Menu.Item key={n.id}>{n.name}</Menu.Item>
                    ))}
                  </Menu>
                }>
                  <Button size="small"><AimOutlined /> 批量关联知识点</Button>
                </Dropdown>
                <Popconfirm title={`确定删除选中的 ${selectedRowKeys.length} 题？`} onConfirm={handleBatchDelete}>
                  <Button size="small" danger><DeleteOutlined /> 批量删除</Button>
                </Popconfirm>
                <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
              </Space>
            </div>
          )}

          {/* Table */}
          <Table
            rowSelection={{
              selectedRowKeys,
              onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
            }}
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 题` }}
            size="small"
            scroll={{ x: 850 }}
          />
        </Card>
      </Col>

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
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" icon={<FileAddOutlined />} onClick={() => importWordResults(wordResult)}>
                导入 {wordResult.count} 道题目到题库
              </Button>
              <Button onClick={() => { setWordResult(null); }}>重新选择文件</Button>
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

          <Divider orientation="left" style={{ fontSize: 12 }}>物理题库扩展信息</Divider>

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

export default QuestionBank;
