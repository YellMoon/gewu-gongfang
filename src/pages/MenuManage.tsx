import React, { useState, useEffect, useCallback } from 'react';
import { Tree, Button, Modal, Input, message, Space, Card, Tag, Switch, Empty } from 'antd';
import { MenuOutlined, PlusOutlined, DeleteOutlined, EditOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons';

interface MenuTreeNode {
  id: string;
  name: string;
  icon: string;
  routeKey: string;
  visible: boolean;
  children: MenuTreeNode[];
}

const STORAGE_KEY = 'menu_tree_geworks';

const DEFAULT_MENU_TREE: MenuTreeNode[] = [
  {
    id: '1', name: '排课管理', icon: 'CalendarOutlined', routeKey: '', visible: true,
    children: [
      { id: '1-1', name: '课程表', icon: 'CalendarOutlined', routeKey: 'course-calendar', visible: true, children: [] },
      { id: '1-2', name: '排课列表', icon: 'FileTextOutlined', routeKey: 'schedule-list', visible: true, children: [] },
    ],
  },
  {
    id: '2', name: '课程管理', icon: 'BookOutlined', routeKey: '', visible: true,
    children: [
      { id: '2-1', name: '课程信息', icon: 'BookOutlined', routeKey: 'course-info', visible: true, children: [] },
    ],
  },
  {
    id: '3', name: '教务管理', icon: 'TeamOutlined', routeKey: '', visible: true,
    children: [
      { id: '3-1', name: '学校', icon: 'TeamOutlined', routeKey: 'school', visible: true, children: [] },
      { id: '3-2', name: '上课地址', icon: 'TeamOutlined', routeKey: 'address', visible: true, children: [] },
    ],
  },
  {
    id: '4', name: '题库管理', icon: 'UploadOutlined', routeKey: '', visible: true,
    children: [
      { id: '4-1', name: '试题导入', icon: 'UploadOutlined', routeKey: 'question-bank-import', visible: true, children: [] },
      { id: '4-2', name: '试题库', icon: 'FileTextOutlined', routeKey: 'question-bank-preview', visible: true, children: [] },
    ],
  },
  {
    id: '5', name: '缴费统计', icon: 'DollarOutlined', routeKey: '', visible: true,
    children: [
      { id: '5-1', name: '缴费', icon: 'DollarOutlined', routeKey: 'payment', visible: true, children: [] },
      { id: '5-2', name: '费用统计', icon: 'BarChartOutlined', routeKey: 'revenue-statistics', visible: true, children: [] },
      { id: '5-3', name: '个人资产统计', icon: 'DatabaseOutlined', routeKey: 'personal-assets', visible: true, children: [] },
    ],
  },
  {
    id: '6', name: '用户管理', icon: 'UserOutlined', routeKey: '', visible: true,
    children: [
      { id: '6-1', name: '管理员', icon: 'UserOutlined', routeKey: 'admin', visible: true, children: [] },
      { id: '6-2', name: '老师', icon: 'TeamOutlined', routeKey: 'teacher', visible: true, children: [] },
      { id: '6-3', name: '学生', icon: 'UserOutlined', routeKey: 'student', visible: true, children: [] },
      { id: '6-4', name: '被邀请者', icon: 'UserOutlined', routeKey: 'invitee', visible: true, children: [] },
    ],
  },
  {
    id: '7', name: '系统设置', icon: 'SettingOutlined', routeKey: '', visible: true,
    children: [
      { id: '7-1', name: '权限管理', icon: 'LockOutlined', routeKey: 'permission', visible: true, children: [] },
      { id: '7-2', name: '云同步', icon: 'DatabaseOutlined', routeKey: 'cloud-sync', visible: true, children: [] },
      { id: '7-3', name: '菜单结构管理', icon: 'MenuOutlined', routeKey: 'menu-manage', visible: true, children: [] },
      { id: '7-4', name: '系统参数', icon: 'SettingOutlined', routeKey: 'system-params', visible: true, children: [] },
      { id: '7-5', name: '操作日志', icon: 'FileTextOutlined', routeKey: 'operate-log', visible: true, children: [] },
    ],
  },
];

// 递归查找节点
function findNode(nodes: MenuTreeNode[], id: string): MenuTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children.length > 0) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

// 递归删除节点
function removeNode(nodes: MenuTreeNode[], id: string): MenuTreeNode[] {
  return nodes.filter(n => {
    if (n.id === id) return false;
    if (n.children.length > 0) n.children = removeNode(n.children, id);
    return true;
  });
}

// 递归更新节点
function updateNode(nodes: MenuTreeNode[], id: string, updater: (n: MenuTreeNode) => MenuTreeNode): MenuTreeNode[] {
  return nodes.map(n => {
    if (n.id === id) return updater(n);
    if (n.children.length > 0) n.children = updateNode(n.children, id, updater);
    return n;
  });
}

// 递归添加子节点
function addChildNode(nodes: MenuTreeNode[], parentId: string, child: MenuTreeNode): MenuTreeNode[] {
  return nodes.map(n => {
    if (n.id === parentId) return { ...n, children: [...n.children, child] };
    if (n.children.length > 0) n.children = addChildNode(n.children, parentId, child);
    return n;
  });
}

// 生成ID
function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// 将树节点转换为 antd Tree 的 data 格式
function toTreeData(nodes: MenuTreeNode[]): any[] {
  return nodes.map(n => ({
    key: n.id,
    title: n.name,
    icon: n.routeKey ? <FileOutlined /> : <FolderOutlined />,
    isLeaf: n.routeKey !== '',
    children: n.children.length > 0 ? toTreeData(n.children) : [],
  }));
}

const MenuManage: React.FC = () => {
  const [treeData, setTreeData] = useState<MenuTreeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<MenuTreeNode | null>(null);
  const [editNameModal, setEditNameModal] = useState(false);
  const [addChildModal, setAddChildModal] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // 加载
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setTreeData(JSON.parse(stored));
      else { setTreeData(DEFAULT_MENU_TREE); localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_MENU_TREE)); }
    } catch (e) {
      console.error('加载菜单配置失败:', e);
      setTreeData(DEFAULT_MENU_TREE);
    }
  }, []);

  const saveTree = useCallback((newTree: MenuTreeNode[]) => {
    setTreeData([...newTree]);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(newTree)); } catch (e) {
      console.error('保存菜单配置失败:', e);
      message.error('保存失败');
    }
  }, []);

  const handleSelect = (_: any, info: any) => {
    if (info.node && info.node.key) {
      const node = findNode(treeData, info.node.key);
      setSelectedNode(node || null);
    }
  };

  // 添加根菜单
  const handleAddRoot = () => {
    const newNode: MenuTreeNode = {
      id: genId(), name: '新分组', icon: 'FolderOutlined', routeKey: '', visible: true, children: [],
    };
    saveTree([...treeData, newNode]);
    setSelectedNode(newNode);
    message.success('已添加新分组');
  };

  // 添加子菜单
  const handleAddChild = () => {
    if (!selectedNode) { message.warning('请先选择一个节点'); return; }
    setInputValue('');
    setAddChildModal(true);
  };

  const confirmAddChild = () => {
    if (!selectedNode || !inputValue.trim()) return;
    const newNode: MenuTreeNode = {
      id: genId(), name: inputValue.trim(), icon: 'FileOutlined', routeKey: '', visible: true, children: [],
    };
    saveTree(addChildNode(treeData, selectedNode.id, newNode));
    setAddChildModal(false);
    message.success('已添加子菜单');
  };

  // 编辑名称
  const handleEditName = () => {
    if (!selectedNode) { message.warning('请先选择一个节点'); return; }
    setInputValue(selectedNode.name);
    setEditNameModal(true);
  };

  const confirmEditName = () => {
    if (!selectedNode || !inputValue.trim()) return;
    saveTree(updateNode(treeData, selectedNode.id, n => ({ ...n, name: inputValue.trim() })));
    setSelectedNode(prev => prev ? { ...prev, name: inputValue.trim() } : null);
    setEditNameModal(false);
    message.success('名称已更新');
  };

  // 切换可见性
  const toggleVisible = () => {
    if (!selectedNode) return;
    saveTree(updateNode(treeData, selectedNode.id, n => ({ ...n, visible: !n.visible })));
    setSelectedNode(prev => prev ? { ...prev, visible: !prev.visible } : null);
    message.success('可见性已切换');
  };

  // 删除节点
  const handleDelete = () => {
    if (!selectedNode) return;
    Modal.confirm({
      title: `删除 "${selectedNode.name}"`,
      content: `确定删除此菜单节点及其所有子节点吗？此操作不可撤销。`,
      okText: '删除', okType: 'danger', cancelText: '取消',
      onOk: () => {
        saveTree(removeNode(treeData, selectedNode.id));
        setSelectedNode(null);
        message.success('已删除');
      },
    });
  };

  // 更新 routeKey
  const handleRouteKeyChange = (val: string) => {
    if (!selectedNode) return;
    saveTree(updateNode(treeData, selectedNode.id, n => ({ ...n, routeKey: val })));
    setSelectedNode(prev => prev ? { ...prev, routeKey: val } : null);
  };

  // 自定义标题渲染
  const titleRender = (nodeData: any) => {
    const key = nodeData.key;
    const node = findNode(treeData, key);
    if (!node) return <span>{nodeData.title}</span>;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        {node.routeKey ? <FileOutlined style={{ color: '#1890ff' }} /> : <FolderOutlined style={{ color: '#faad14' }} />}
        <span style={{ fontWeight: node.routeKey ? 'normal' : 600, color: node.visible ? undefined : '#bbb' }}>
          {node.name}
        </span>
        {!node.visible && <Tag color="default" style={{ fontSize: 10, lineHeight: '14px', marginLeft: 4 }}>隐藏</Tag>}
      </div>
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<span><MenuOutlined style={{ marginRight: 8 }} />菜单结构管理</span>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRoot}>
            添加根菜单
          </Button>
        }
      >
        <div style={{ display: 'flex', gap: 16, minHeight: 400 }}>
          {/* 左侧树 */}
          <div style={{ width: 300, border: '1px solid #e8e8e8', borderRadius: 6, padding: 8, overflow: 'auto' }}>
            <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>目录结构（点击节点查看详情）</div>
            {treeData.length > 0 ? (
              <Tree
                treeData={toTreeData(treeData)}
                defaultExpandAll
                showIcon
                titleRender={titleRender}
                onSelect={handleSelect}
              />
            ) : (
              <Empty description="暂无菜单数据" />
            )}
          </div>
          {/* 右侧详情 */}
          <div style={{ flex: 1, border: '1px solid #e8e8e8', borderRadius: 6, padding: 16 }}>
            {selectedNode ? (
              <div>
                <h4 style={{ margin: '0 0 16px 0' }}>
                  <FolderOutlined style={{ marginRight: 8 }} />{selectedNode.name}
                  <Tag color={selectedNode.visible ? 'green' : 'default'} style={{ marginLeft: 8 }}>
                    {selectedNode.visible ? '显示' : '隐藏'}
                  </Tag>
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontWeight: 500, marginRight: 8 }}>节点ID:</label>
                    <code style={{ color: '#888' }}>{selectedNode.id}</code>
                  </div>
                  <div>
                    <label style={{ fontWeight: 500, marginRight: 8 }}>名称:</label>
                    {selectedNode.name}
                  </div>
                  <div>
                    <label style={{ fontWeight: 500, marginRight: 8 }}>路由Key:</label>
                    <Input
                      size="small"
                      style={{ width: 240 }}
                      placeholder="留空表示分组节点（而非叶子菜单）"
                      value={selectedNode.routeKey}
                      onChange={e => handleRouteKeyChange(e.target.value)}
                    />
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>叶子节点填写路由key（如 course-calendar），分组节点留空</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 500, marginRight: 8 }}>可见性:</label>
                    <Switch
                      checked={selectedNode.visible}
                      onChange={toggleVisible}
                      checkedChildren="显示"
                      unCheckedChildren="隐藏"
                    />
                  </div>
                  <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12, display: 'flex', gap: 8 }}>
                    <Button size="small" icon={<PlusOutlined />} onClick={handleAddChild}>添加子菜单</Button>
                    <Button size="small" icon={<EditOutlined />} onClick={handleEditName}>重命名</Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={handleDelete}>删除</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: '#999', textAlign: 'center', paddingTop: 60 }}>
                点击左侧树节点查看和编辑菜单详情
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 重命名对话框 */}
      <Modal title="重命名" open={editNameModal} onOk={confirmEditName} onCancel={() => setEditNameModal(false)} okText="保存" cancelText="取消">
        <Input value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder="输入新名称" />
      </Modal>
      {/* 添加子菜单对话框 */}
      <Modal title="添加子菜单" open={addChildModal} onOk={confirmAddChild} onCancel={() => setAddChildModal(false)} okText="添加" cancelText="取消">
        <Input value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder="输入子菜单名称" />
      </Modal>
    </div>
  );
};

export default MenuManage;
