import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select as AntSelect, Space, Tag, message,
  Popconfirm, Tooltip, Tree, Divider, Badge, Checkbox, Dropdown, Menu, Empty, Row, Col, Typography
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, CopyOutlined,
  FolderOpenOutlined, TagsOutlined, AimOutlined, BranchesOutlined,
  CheckCircleOutlined, DownloadOutlined, FileWordOutlined, CloseCircleOutlined,
  EyeOutlined
} from '@ant-design/icons';
import type { Question, KnowledgeNode } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import QuestionRenderer, { createKaTeXPhysicsOptions } from '../components/QuestionRenderer';
import katex from 'katex';
import { applyPhysicsNotationToHTML } from '../utils/physicsNotation';

const { TextArea } = Input;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
const QUESTION_TYPES = ['单选题', '多选题', '实验题', '解答题', '判断题'];
const EXAM_TYPES = ['高考真题', '模拟题', '期中考试', '期末考试', '月考', '开学考', '单元测试'];
const GRADES = ['高一', '高二', '高三'];
const LIMIT_GRADES = ['不限', ...GRADES];
const LIMIT_SEMESTERS = ['不限', '上学期', '下学期'];
const PREVIEW_QUESTION_TYPES = ['单选题', '多选题', '实验题', '解答题', '判断题'];
const LIMIT_TYPES = ['不限', ...PREVIEW_QUESTION_TYPES];
const SEMESTERS = ['上学期', '下学期'];

// 用于 Word 导出的最小 KaTeX CSS 子集（覆盖物理公式常用构造）
const KATEX_EXPORT_CSS = `
.katex{font:normal 1.21em "KaTeX_Main","Times New Roman",serif;line-height:1.2;text-indent:0;text-rendering:auto}
.katex *{border-color:currentColor}
.katex .katex-html>.newline{display:block}
.katex .base{position:relative;white-space:nowrap;width:min-content;display:inline-block}
.katex .strut{display:inline-block}
.katex .textbf{font-weight:700}
.katex .textit{font-style:italic}
.katex .textrm{font-family:"KaTeX_Main","Times New Roman",serif}
.katex .mathrm{font-style:normal}
.katex .mathbf{font-family:"KaTeX_Main","Times New Roman",serif;font-weight:700}
.katex .mathit{font-family:"KaTeX_Main","Times New Roman",serif;font-style:italic}
.katex .mathnormal{font-family:"KaTeX_Math","Times New Roman",serif;font-style:italic}
.katex .boldsymbol{font-family:"KaTeX_Math","Times New Roman",serif;font-style:italic;font-weight:700}
.katex .amsrm{font-family:"KaTeX_AMS","Times New Roman",serif}
.katex .mathcal{font-family:"KaTeX_Caligraphic","Times New Roman",serif}
.katex .mainrm{font-family:"KaTeX_Main","Times New Roman",serif;font-style:normal}
.katex .vlist-t{border-collapse:collapse;display:inline-table;table-layout:fixed}
.katex .vlist-r{display:table-row}
.katex .vlist{display:table-cell;position:relative;vertical-align:bottom}
.katex .vlist>span{display:block;height:0;position:relative}
.katex .vlist>span>span{display:inline-block}
.katex .vlist>span>.pstrut{overflow:hidden;width:0}
.katex .vlist-t2{margin-right:-2px}
.katex .vlist-s{display:table-cell;font-size:1px;min-width:2px;vertical-align:bottom;width:2px}
.katex .vbox{display:inline-flex;flex-direction:column;align-items:baseline}
.katex .hbox{width:100%;display:inline-flex;flex-direction:row}
.katex .thinbox{width:0;max-width:0;display:inline-flex;flex-direction:row}
.katex .msupsub{text-align:left}
.katex .mfrac>span>span{text-align:center}
.katex .mfrac .frac-line{border-bottom-style:solid;display:inline-block;width:100%;min-height:1px}
.katex .mspace{display:inline-block}
.katex .llap,.katex .rlap,.katex .clap{width:0;position:relative}
.katex .llap>.inner,.katex .rlap>.inner,.katex .clap>.inner{position:absolute}
.katex .llap>.fix,.katex .rlap>.fix,.katex .clap>.fix{display:inline-block}
.katex .llap>.inner{right:0}
.katex .rlap>.inner,.katex .clap>.inner{left:0}
.katex .clap>.inner>span{margin-left:-50%;margin-right:50%}
.katex .rule{border:0 solid;display:inline-block;position:relative;min-height:1px}
.katex .hline,.katex .overline .overline-line,.katex .underline .underline-line{border-bottom-style:solid;display:inline-block;width:100%;min-height:1px}
.katex .sqrt>.root{margin-left:.2777777778em;margin-right:-.5555555556em}
.katex .op-symbol{position:relative}
.katex .op-symbol.small-op{font-family:"KaTeX_Size1","Times New Roman",serif}
.katex .op-symbol.large-op{font-family:"KaTeX_Size2","Times New Roman",serif}
.katex .accent>.vlist-t,.katex .op-limits>.vlist-t{text-align:center}
.katex .accent .accent-body{position:relative;width:0}
.katex .accent .accent-body:not(.accent-full){width:0}
.katex .overlay{display:block}
.katex .mtable .vertical-separator{display:inline-block;min-width:1px}
.katex .mtable .arraycolsep{display:inline-block}
.katex .mtable .col-align-c>.vlist-t{text-align:center}
.katex .mtable .col-align-l>.vlist-t{text-align:left}
.katex .mtable .col-align-r>.vlist-t{text-align:right}
.katex .stretchy{display:block;overflow:hidden;position:relative;width:100%}
.katex .hide-tail{overflow:hidden;position:relative;width:100%}
.katex .halfarrow-left{position:absolute;left:0;overflow:hidden;width:50.2%}
.katex .halfarrow-right{position:absolute;right:0;overflow:hidden;width:50.2%}
.katex .brace-left{position:absolute;left:0;overflow:hidden;width:25.1%}
.katex .brace-center{position:absolute;left:25%;overflow:hidden;width:50%}
.katex .brace-right{position:absolute;right:0;overflow:hidden;width:25.1%}
.katex .x-arrow-pad{padding:0 .5em}
.katex .mover,.katex .munder,.katex .x-arrow{text-align:center}
.katex .boxpad{padding:0 .3em}
.katex .fbox,.katex .fcolorbox{box-sizing:border-box;border:.04em solid}
.katex .cancel-pad{padding:0 .2em}
.katex .cancel-lap{margin-left:-.2em;margin-right:-.2em}
.katex .sout{border-bottom-style:solid;border-bottom-width:.08em}
.katex .angl{box-sizing:border-box;border-right:.049em solid;border-top:.049em solid;margin-right:.03889em}
.katex .anglpad{padding:0 .03889em}
.katex .nulldelimiter{display:inline-block;width:.12em}
.katex .delimcenter{position:relative}
.katex .sizing.reset-size1.size1{font-size:1em}
.katex .sizing.reset-size1.size2{font-size:1.2em}
.katex .sizing.reset-size1.size3{font-size:1.4em}
.katex .sizing.reset-size1.size4{font-size:1.6em}
.katex .sizing.reset-size1.size5{font-size:1.8em}
.katex .sizing.reset-size1.size6{font-size:2em}
.katex .sizing.reset-size1.size7{font-size:2.4em}
.katex .sizing.reset-size1.size8{font-size:2.88em}
.katex .sizing.reset-size2.size2{font-size:1em}
.katex .sizing.reset-size3.size3{font-size:1em}
.katex .sizing.reset-size4.size4{font-size:1em}
.katex .sizing.reset-size5.size5{font-size:1em}
.katex .sizing.reset-size6.size6{font-size:1em}
.katex .sizing.reset-size7.size7{font-size:1em}
.katex .sizing.reset-size8.size8{font-size:1em}
.katex .sizing.reset-size9.size9{font-size:1em}
.katex .sizing.reset-size10.size10{font-size:1em}
.katex .sizing.reset-size11.size11{font-size:1em}
.katex .delimsizing.size1{font-family:"KaTeX_Size1","Times New Roman",serif}
.katex .delimsizing.size2{font-family:"KaTeX_Size2","Times New Roman",serif}
.katex .delimsizing.size3{font-family:"KaTeX_Size3","Times New Roman",serif}
.katex .delimsizing.size4{font-family:"KaTeX_Size4","Times New Roman",serif}
.katex-display{display:block;margin:.5em 0;text-align:center}
.katex-display>.katex{display:block;text-align:center;white-space:nowrap}
.katex-display>.katex>.katex-html{display:block;position:relative}
.katex .katex-mathml{position:absolute;width:1px;height:1px;overflow:hidden;padding:0;border:0;clip:rect(0,0,0,0)}
.katex svg{display:block;position:absolute;width:100%;height:inherit;fill:currentColor;stroke:currentColor}
.katex svg path{stroke:none}
.katex img{border-style:none;min-width:0;min-height:0;max-width:none;max-height:none}
`;

// 将内容中的 $$...$$ 公式渲染为 KaTeX HTML（用于 Word 导出），并应用物理学科正斜体规范
function renderContentForExport(content: string): string {
  if (!content) return '';
  const re = /\$\$([\s\S]*?)\$\$/g;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      // 非数学段落：应用物理学科字体规范
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
  const [filterSubjects, setFilterSubjects] = useState<string[]>(['物理']); // default: 物理
  const [filterTypes, setFilterTypes] = useState<string[]>(['不限']); // default: 不限
  const [filterExamTypes, setFilterExamTypes] = useState<string[]>([...EXAM_TYPES]); // default all
  const [filterGrades, setFilterGrades] = useState<string[]>(['不限']); // default: 不限
  const [filterSemesters, setFilterSemesters] = useState<string[]>(['不限']); // default: 不限
  const [filterYear, setFilterYear] = useState<string | undefined>(undefined);

  // 排除知识点
  const [filterExcludeKnowledgeIds, setFilterExcludeKnowledgeIds] = useState<(string | undefined)[]>([undefined]);

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
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
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

  // 将知识点 ID 展开为所有底层后代（用于筛选）
  const expandedIncludeIds = activeKnowledgeIds
    .filter(id => !!id)
    .flatMap(id => getDescendantIds(knowledgeNodes, id));
  const expandedExcludeIds = filterExcludeKnowledgeIds
    .filter((id): id is string => !!id)
    .flatMap(id => getDescendantIds(knowledgeNodes, id));

  // Filters
  const filtered = questions.filter(q => {
    if (filterSubjects.length > 0 && !filterSubjects.includes(q.subject)) return false;
    if (!filterTypes.includes('不限') && filterTypes.length > 0 && !filterTypes.includes(q.type)) return false;
    if (filterExamTypes.length > 0 && q.exam_type && !filterExamTypes.includes(q.exam_type)) return false;
    if (!filterGrades.includes('不限') && filterGrades.length > 0 && !filterGrades.includes(q.grade || '')) return false;
    if (!filterSemesters.includes('不限') && filterSemesters.length > 0 && !filterSemesters.includes(q.semester || '')) return false;
    if (filterYear && q.year !== filterYear) return false;
    if (appliedSearchText && !q.content.includes(appliedSearchText)) return false;
    const qKnowledgeIds = q.knowledge_ids || [];
    // 知识点 AND 逻辑（展开为后代）
    if (expandedIncludeIds.length > 0) {
      if (!expandedIncludeIds.every(kid => qKnowledgeIds.includes(kid))) return false;
    }
    // 排除知识点（展开为后代，任一匹配则排除）
    if (expandedExcludeIds.length > 0) {
      if (expandedExcludeIds.some(kid => qKnowledgeIds.includes(kid))) return false;
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
      '单选题': '一、单选题',
      '多选题': '二、多选题',
      '实验题': '三、实验题',
      '判断题': '四、判断题',
      '解答题': '五、解答题',
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

  const getNodeName = (id: string) => {
    const n = knowledgeNodes.find(x => x.id === id);
    return n ? n.name : id;
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
      title: '来源', key: 'source', width: 80,
      render: (_: any, r: Question) => r.exam_type ? <Tag>{r.exam_type}</Tag> : '-'
    },
    { title: '年级', dataIndex: 'grade', key: 'grade', width: 70, render: (g: string) => g || '-' },
    { title: '学年', dataIndex: 'year', key: 'year', width: 70, render: (y: string) => y || '-' },
    { title: '学期', dataIndex: 'semester', key: 'semester', width: 70, render: (s: string) => s || '-' },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, r: Question) => (
        <Space size={0}>
          <Tooltip title="预览"><Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setPreviewQuestion(r)} /></Tooltip>
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
            title={<span><BranchesOutlined /> 知识树</span>}
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

            {/* Row 3: 学期（右）+ 学年 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                  options={EXAM_TYPES}
                  value={filterExamTypes}
                  onChange={(vals) => setFilterExamTypes(vals as string[])}
                />
              </div>
            </div>

            {/* Row 5: 搜索题干 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  已选 {activeKnowledgeIds.length} 个知识点（AND 筛选），共覆盖 {expandedIncludeIds.length} 个后代节点
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
