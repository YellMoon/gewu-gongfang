import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag, message,
  Popconfirm, Tooltip, Tree, Divider, Badge, Checkbox, Dropdown, Menu, Empty, Row, Col, Typography
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, CopyOutlined,
  FolderOpenOutlined, TagsOutlined, AimOutlined, BranchesOutlined,
  CheckCircleOutlined, DownloadOutlined, FileWordOutlined, CloseCircleOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode } from '../types';

const { TextArea } = Input;
const { Text } = Typography;

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const QUESTION_TYPES = ['选择题', '填空题', '解答题', '判断题', '简答题', '实验题', '多选题', '作图题'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试'];
const GRADES = ['高一', '高二', '高三'];
const LIMIT_GRADES = ['不限', ...GRADES];
const LIMIT_SEMESTERS = ['不限', '上学期', '下学期'];
const PREVIEW_QUESTION_TYPES = ['单选题', '多选题', '实验题', '解答题', '判断题'];
const LIMIT_TYPES = ['不限', ...PREVIEW_QUESTION_TYPES];
const SEMESTERS = ['上学期', '下学期'];

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

  // Multi-select filter state
  const [filterSubjects, setFilterSubjects] = useState<string[]>([]); // empty = show all
  const [filterTypes, setFilterTypes] = useState<string[]>(['不限']); // default: 不限
  const [filterExamTypes, setFilterExamTypes] = useState<string[]>([...EXAM_TYPES]); // default all
  const [filterGrades, setFilterGrades] = useState<string[]>(['不限']); // default: 不限
  const [filterSemesters, setFilterSemesters] = useState<string[]>(['不限']); // default: 不限
  const [filterYear, setFilterYear] = useState<string | undefined>(undefined);

  const [searchText, setSearchText] = useState<string>('');
  const [appliedSearchText, setAppliedSearchText] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
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

  const loadData = useCallback(() => {
    try {
      const db = (window as any).dbService;
      if (!db) return;
      setQuestions(db.getAllQuestions?.() || []);
      const kn = db.getKnowledgeTree?.() || [];
      setKnowledgeNodes(kn);
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

  // Filters
  const filtered = questions.filter(q => {
    // 科目
    if (filterSubjects.length > 0 && !filterSubjects.includes(q.subject)) return false;
    // 题型（不限表示不过滤）
    if (!filterTypes.includes('不限') && filterTypes.length > 0 && !filterTypes.includes(q.type)) return false;
    // 考试类型
    if (filterExamTypes.length > 0 && !filterExamTypes.includes(q.exam_type || '')) return false;
    // 年级（不限表示不过滤）
    if (!filterGrades.includes('不限') && filterGrades.length > 0 && !filterGrades.includes(q.grade || '')) return false;
    // 学期（不限表示不过滤）
    if (!filterSemesters.includes('不限') && filterSemesters.length > 0 && !filterSemesters.includes(q.semester || '')) return false;
    // 学年精确匹配
    if (filterYear && q.year !== filterYear) return false;
    // 题干搜索（点击搜索按钮后生效）
    if (appliedSearchText && !q.content.includes(appliedSearchText)) return false;
    // 知识点 AND 逻辑
    if (activeKnowledgeIds.length > 0) {
      const qKnowledgeIds = q.knowledge_ids || [];
      if (!activeKnowledgeIds.every(kid => qKnowledgeIds.includes(kid))) return false;
    }
    return true;
  }).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

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
    const prevParentId = draggedNode?.parent_id || null;
    const db = (window as any).dbService;
    if (!db) return;
    db.updateKnowledgeNode(dragKey, { parent_id: newParentId });
    setKnowledgeNodes((db.getKnowledgeTree?.() || []).map((n: any) => ({...n})));
    Modal.confirm({
      title: '确认移动', content: '确定将选中知识点及其所有子节点移动到此位置？',
      okText: '移动', cancelText: '取消',
      onOk: () => { message.success('知识点已移动'); },
      onCancel: () => {
        db.updateKnowledgeNode(dragKey, { parent_id: prevParentId });
        setKnowledgeNodes((db.getKnowledgeTree?.() || []).map((n: any) => ({...n})));
        message.info('已取消移动');
      },
    });
  };

  const treeData = buildTreeData(knowledgeNodes);

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
        const ids = [...new Set([...(q.knowledge_ids || []), knowledgeId])];
        db.updateQuestion(id, { knowledge_ids: ids });
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
      '选择题': '一、选择题',
      '多选题': '二、多选题',
      '填空题': '三、填空题',
      '判断题': '四、判断题',
      '简答题': '五、简答题',
      '解答题': '六、解答题',
      '实验题': '七、实验题',
      '作图题': '八、作图题',
    };

    // 按题型分组
    const groups: Record<string, Question[]> = {};
    items.forEach(q => {
      const t = q.type || '其他';
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
          <Tooltip title="编辑"><Button type="link" size="small" icon={<EditOutlined />} onClick={() => {
            setEditing(r);
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

  const menu = (
    <Menu onClick={({ key }) => handleBatchKnowledge(key)}>
      {knowledgeNodes.map(n => (
        <Menu.Item key={n.id}>{n.name}</Menu.Item>
      ))}
    </Menu>
  );

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

            <style>{`
              .knowledge-tree .ant-tree-switcher { width: 14px !important; }
              .knowledge-tree .ant-tree-indent-unit { width: 14px !important; }
              .knowledge-tree .ant-tree-treenode {
                padding-bottom: 4px !important;
              }
              .knowledge-tree .ant-tree-show-line .ant-tree-indent-unit::before {
                border-right: 1px dashed #d9d9d9 !important;
              }
            `}</style>
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
              {selectedRowKeys.length > 0 && (
                <div style={{ color: '#1890ff', fontWeight: 'bold', marginTop: 8 }}>
                  已选 {selectedRowKeys.length} 题
                </div>
              )}
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
                <Button type="link" icon={<BranchesOutlined />} onClick={() => setTreeVisible(true)}>展开知识树</Button>
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
                onChange={(vals) => {
                  if (vals.includes('不限') && vals.length > 1) {
                    setFilterTypes(vals.filter(v => v !== '不限'));
                  } else if (vals.length === 0) {
                    setFilterTypes(['不限']);
                  } else {
                    setFilterTypes(vals as string[]);
                  }
                }}
              />
            </div>

            {/* Row 2: 年级（单独一行）*/}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>年级：</span>
              <Checkbox.Group
                options={LIMIT_GRADES}
                value={filterGrades}
                onChange={(vals) => {
                  if (vals.includes('不限') && vals.length > 1) {
                    setFilterGrades(vals.filter(v => v !== '不限'));
                  } else if (vals.length === 0) {
                    setFilterGrades(['不限']);
                  } else {
                    setFilterGrades(vals as string[]);
                  }
                }}
              />
            </div>

            {/* Row 3: 学期（单独一行）*/}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>学期：</span>
              <Checkbox.Group
                options={LIMIT_SEMESTERS}
                value={filterSemesters}
                onChange={(vals) => {
                  if (vals.includes('不限') && vals.length > 1) {
                    setFilterSemesters(vals.filter(v => v !== '不限'));
                  } else if (vals.length === 0) {
                    setFilterSemesters(['不限']);
                  } else {
                    setFilterSemesters(vals as string[]);
                  }
                }}
              />
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
                  options={EXAM_TYPES}
                  value={filterExamTypes}
                  onChange={(vals) => setFilterExamTypes(vals as string[])}
                />
              </div>
            </div>

            {/* Row 5: 学年（左）| 搜索题干（右）*/}
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input
                  placeholder="搜索题干..."
                  allowClear
                  style={{ width: 280 }}
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  onPressEnter={handleSearch}
                />
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
              </div>
            </div>

            {/* Row 6: 知识点多选模糊搜索 */}
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
                  已选 {activeKnowledgeIds.length} 个知识点（AND 筛选）
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
            scroll={{ x: 800 }}
          />
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
              {knowledgeNodes.length > 0 ? renderKnowledgeCheckboxes(knowledgeNodes) : <Empty description="暂无知识树数据" />}
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
};

export default QuestionBankPreview;
