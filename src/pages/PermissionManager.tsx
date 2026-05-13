/**
 * 权限管理页面
 * 
 * 注意：小程序端不允许打开本软件的权限管理功能。
 * 如需在小程序中使用，应在此组件外层增加环境判断并阻止渲染。
 */

import React, { useState, useEffect } from 'react';
import { 
  Card, Table, Button, Modal, Select as AntSelect, Input, Radio, DatePicker,
  Space, message, Popconfirm, Tag 
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import AutoCloseSelect from '../components/AutoCloseSelect';

const { RangePicker } = DatePicker;
const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;

// ====== 系统功能模块定义 ======
const PERMISSION_MODULES = [
  '排课管理',
  '课程管理',
  '学生管理',
  '老师管理',
  '题库管理',
  '财务报表',
  '系统设置',
  '云同步',
];

type UserType = 'admin' | 'teacher' | 'student' | 'invitee';

const USER_TYPE_OPTIONS: { value: UserType; label: string }[] = [
  { value: 'admin', label: '管理员' },
  { value: 'teacher', label: '老师' },
  { value: 'student', label: '学生' },
  { value: 'invitee', label: '被邀请者' },
];

const USER_TYPE_LABELS: Record<UserType, string> = {
  admin: '管理员',
  teacher: '老师',
  student: '学生',
  invitee: '被邀请者',
};

type PermissionLevel = 'none' | 'read' | 'all';

const PERMISSION_LEVEL_OPTIONS: { value: PermissionLevel; label: string }[] = [
  { value: 'none', label: '无任何权限' },
  { value: 'read', label: '只读' },
  { value: 'all', label: '所有（包含编辑修改）' },
];

interface PermissionEntry {
  id: string;
  userType: UserType;
  userId: string;
  userName: string;
  module: string;
  permissionLevel: PermissionLevel;
  grantTime: string;
  expireTime: string;
}

interface UserOption {
  id: string;
  name: string;
}

const PERMISSION_STORAGE_KEY = 'permissions_data';

const PermissionManager: React.FC = () => {
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PermissionEntry | null>(null);

  // Modal form state
  const [userType, setUserType] = useState<UserType>('teacher');
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [modulePermissions, setModulePermissions] = useState<Record<string, PermissionLevel>>({});
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [submitLoading, setSubmitLoading] = useState(false);

  const dbService = (window as any).dbService;

  // ====== 数据加载 ======
  const loadPermissions = () => {
    try {
      const raw = localStorage.getItem(PERMISSION_STORAGE_KEY);
      const entries: PermissionEntry[] = raw ? JSON.parse(raw) : [];
      setPermissions(entries);
    } catch (e) {
      console.error('加载权限数据失败:', e);
      setPermissions([]);
    }
  };

  const savePermissions = (entries: PermissionEntry[]) => {
    localStorage.setItem(PERMISSION_STORAGE_KEY, JSON.stringify(entries));
    setPermissions(entries);
  };

  const loadUsersByType = (type: UserType): UserOption[] => {
    if (!dbService) return [];
    try {
      switch (type) {
        case 'teacher':
          return (dbService.getAllTeachers() || []).map((t: any) => ({ id: t.id, name: t.name || '未命名' }));
        case 'student':
          return (dbService.getAllStudents() || []).map((s: any) => ({ id: s.id, name: s.name || '未命名' }));
        case 'admin':
        case 'invitee':
          return [];
        default:
          return [];
      }
    } catch (e) {
      console.error('加载用户列表失败:', e);
      return [];
    }
  };

  // ====== 权限层级标签 ======
  const renderPermissionLevel = (level: PermissionLevel) => {
    switch (level) {
      case 'none':
        return <Tag>无权限</Tag>;
      case 'read':
        return <Tag color="blue">只读</Tag>;
      case 'all':
        return <Tag color="green">所有</Tag>;
      default:
        return <Tag>未知</Tag>;
    }
  };

  // ====== 日期格式化 ======
  const formatDate = (isoStr: string) => {
    if (!isoStr) return '永久';
    try {
      return new Date(isoStr).toLocaleDateString('zh-CN');
    } catch {
      return isoStr;
    }
  };

  // ====== 初始化所有模块权限为 none ======
  const resetModulePermissions = () => {
    const perms: Record<string, PermissionLevel> = {};
    PERMISSION_MODULES.forEach(m => { perms[m] = 'none'; });
    return perms;
  };

  // ====== 打开添加模态框 ======
  const handleOpenAdd = () => {
    setEditingEntry(null);
    setUserType('teacher');
    setUserId(null);
    setUserName('');
    setModulePermissions(resetModulePermissions());
    setDateRange(null);
    setUserOptions(loadUsersByType('teacher'));
    setModalVisible(true);
  };

  // ====== 打开编辑模态框 ======
  const handleOpenEdit = (entry: PermissionEntry) => {
    setEditingEntry(entry);

    // 加载该用户的所有权限条目，用于填充表单
    const userPerms = permissions.filter(p => p.userId === entry.userId);

    setUserType(entry.userType);
    setUserId(entry.userId);
    setUserName(entry.userName);

    // 填充模块权限
    const perms: Record<string, PermissionLevel> = resetModulePermissions();
    userPerms.forEach(p => {
      if (PERMISSION_MODULES.includes(p.module)) {
        perms[p.module] = p.permissionLevel;
      }
    });
    setModulePermissions(perms);

    // 时间范围：使用编辑的条目的时间
    if (entry.expireTime) {
      setDateRange([dayjs(entry.grantTime), dayjs(entry.expireTime)]);
    } else {
      setDateRange(null);
    }

    setUserOptions(loadUsersByType(entry.userType));
    setModalVisible(true);
  };

  // ====== 删除单条权限 ======
  const handleDelete = (id: string) => {
    const updated = permissions.filter(p => p.id !== id);
    savePermissions(updated);
    message.success('权限已删除');
  };

  // ====== 保存权限 ======
  const handleSave = async () => {
    setSubmitLoading(true);
    try {
      // 参数校验
      if (!userName.trim()) {
        message.warning('请选择或输入用户');
        setSubmitLoading(false);
        return;
      }

      const now = new Date().toISOString();
      const grantTime = dateRange ? dateRange[0].toISOString() : now;
      const expireTime = dateRange ? dateRange[1].toISOString() : '';

      let updatedPermissions = [...permissions];

      // 如果是编辑模式，先删除该用户的所有旧权限条目
      if (editingEntry) {
        updatedPermissions = updatedPermissions.filter(p => p.userId !== editingEntry.userId);
      } else if (userId) {
        // 新增模式：如果该用户已有权限，先删除旧的再创建新的
        updatedPermissions = updatedPermissions.filter(p => p.userId !== userId);
      }

      // 为该用户创建每个功能模块的权限条目
      const newEntries: PermissionEntry[] = [];
      PERMISSION_MODULES.forEach(module => {
        const level = modulePermissions[module] || 'none';
        if (level !== 'none') {
          newEntries.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
            userType,
            userId: userId || userName,
            userName: userName.trim(),
            module,
            permissionLevel: level,
            grantTime,
            expireTime,
          });
        }
      });

      updatedPermissions = [...updatedPermissions, ...newEntries];
      savePermissions(updatedPermissions);

      message.success(newEntries.length > 0 ? '权限设置保存成功' : '已清空该用户的所有权限');
      setModalVisible(false);
    } catch (e) {
      console.error('保存权限失败:', e);
      message.error('保存失败，请重试');
    } finally {
      setSubmitLoading(false);
    }
  };

  // ====== 用户类型切换 ======
  const handleUserTypeChange = (type: UserType) => {
    setUserType(type);
    setUserId(null);
    setUserName('');
    setModulePermissions(resetModulePermissions());
    setDateRange(null);
    setUserOptions(loadUsersByType(type));
  };

  // ====== 用户选择 ======
  const handleUserSelect = (value: string) => {
    setUserId(value);
    const user = userOptions.find(u => u.id === value);
    if (user) setUserName(user.name);
  };

  // ====== 模块权限变更 ======
  const handleModulePermissionChange = (module: string, level: PermissionLevel) => {
    setModulePermissions(prev => ({ ...prev, [module]: level }));
  };

  // ====== 查看某用户是否已有权限 ======
  const getUserPermissionCount = (userId: string): number => {
    return permissions.filter(p => p.userId === userId).length;
  };

  useEffect(() => {
    loadPermissions();
  }, []);

  // ====== 表格列定义 ======
  const columns: ColumnsType<PermissionEntry> = [
    {
      title: '用户类型',
      dataIndex: 'userType',
      key: 'userType',
      width: 100,
      render: (t: UserType) => USER_TYPE_LABELS[t] || t,
    },
    {
      title: '用户名',
      dataIndex: 'userName',
      key: 'userName',
      width: 120,
    },
    {
      title: '功能模块',
      dataIndex: 'module',
      key: 'module',
      width: 120,
    },
    {
      title: '权限等级',
      dataIndex: 'permissionLevel',
      key: 'permissionLevel',
      width: 120,
      render: renderPermissionLevel,
    },
    {
      title: '授权时间',
      dataIndex: 'grantTime',
      key: 'grantTime',
      width: 120,
      render: formatDate,
    },
    {
      title: '到期时间',
      dataIndex: 'expireTime',
      key: 'expireTime',
      width: 120,
      render: formatDate,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleOpenEdit(record)}
            size="small"
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此权限吗？"
            description="删除后该用户将失去对应功能模块的访问权限。"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ====== 模块权限表列 ======
  const moduleColumns: ColumnsType<{ module: string }> = [
    {
      title: '功能模块',
      dataIndex: 'module',
      key: 'module',
      width: 120,
      render: (m: string) => <strong>{m}</strong>,
    },
    {
      title: '权限设置（默认：无任何权限）',
      key: 'permission',
      render: (_, record) => (
        <Radio.Group
          value={modulePermissions[record.module] || 'none'}
          onChange={(e) => handleModulePermissionChange(record.module, e.target.value)}
        >
          {PERMISSION_LEVEL_OPTIONS.map(opt => (
            <Radio key={opt.value} value={opt.value}>
              {opt.label}
            </Radio>
          ))}
        </Radio.Group>
      ),
    },
  ];

  return (
    <Card>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 style={{ margin: 0 }}>权限管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
          权限设置
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={permissions}
        rowKey="id"
        pagination={{ pageSize: 20 }}
        scroll={{ x: 900 }}
        locale={{ emptyText: '暂无权限设置，点击「权限设置」按钮添加' }}
      />

      {/* ====== 权限设置模态框 ====== */}
      <Modal
        title={editingEntry ? '编辑权限' : '权限设置'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        width={760}
        destroyOnClose
        confirmLoading={submitLoading}
        okText="确定"
        cancelText="取消"
      >
        {/* 用户类型选择 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontWeight: 500, display: 'block', marginBottom: 8 }}>
            用户类型
          </label>
          <Select
            value={userType}
            onChange={handleUserTypeChange}
            style={{ width: 240 }}
          >
            {USER_TYPE_OPTIONS.map(opt => (
              <Option key={opt.value} value={opt.value}>
                {opt.label}
              </Option>
            ))}
          </Select>
        </div>

        {/* 用户选择 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontWeight: 500, display: 'block', marginBottom: 8 }}>
            选择用户
          </label>
          {userType === 'admin' || userType === 'invitee' ? (
            <Input
              placeholder="请输入用户名"
              value={userName}
              onChange={(e) => {
                setUserName(e.target.value);
                setUserId(e.target.value);
              }}
              style={{ width: 400 }}
            />
          ) : (
            <Select
              value={userId}
              onChange={handleUserSelect}
              placeholder="请选择用户"
              style={{ width: 400 }}
              showSearch
              filterOption={(input, option) =>
                String((option as any)?.children || '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              notFoundContent="暂无用户数据，请先在对应模块添加用户"
            >
              {userOptions.map(u => (
                <Option key={u.id} value={u.id}>
                  {u.name}
                </Option>
              ))}
            </Select>
          )}
          {userId && getUserPermissionCount(userId) > 0 && !editingEntry && (
            <div style={{ color: '#faad14', fontSize: 12, marginTop: 4 }}>
              该用户已有 {getUserPermissionCount(userId)} 条权限设置，保存后将覆盖原有权限。
            </div>
          )}
        </div>

        {/* 模块权限树形表 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontWeight: 500, display: 'block', marginBottom: 8 }}>
            功能模块权限（老师、学生、被邀请者默认无任何权限）
          </label>
          <Table
            columns={moduleColumns}
            dataSource={PERMISSION_MODULES.map(m => ({ module: m, key: m }))}
            rowKey="key"
            pagination={false}
            showHeader={true}
            size="small"
            bordered
          />
        </div>

        {/* 授权时间范围 */}
        <div>
          <label style={{ fontWeight: 500, display: 'block', marginBottom: 8 }}>
            授权时间范围
          </label>
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            style={{ width: 360 }}
          />
          <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
            不选择时间范围表示永久有效；到期后权限自动失效（恢复为无任何权限）
          </div>
        </div>
      </Modal>
      {/* ====== 邀请功能区域 ====== */}
      <InviteSection />
    </Card>
  );
};

// ====== 邀请功能组件 ======
interface InviteCode {
  code: string;
  created_at: string;
  used: boolean;
  used_by: string;
}

const INVITE_STORAGE_KEY = 'invite_codes_geworks';

const generateInviteCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const loadInviteCodes = (): InviteCode[] => {
  try {
    const raw = localStorage.getItem(INVITE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveInviteCodes = (codes: InviteCode[]) => {
  localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(codes));
};

const InviteSection: React.FC = () => {
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [latestCode, setLatestCode] = useState<string>('');

  useEffect(() => {
    setInviteCodes(loadInviteCodes());
  }, []);

  const handleGenerate = () => {
    const newCode: InviteCode = {
      code: generateInviteCode(),
      created_at: new Date().toISOString(),
      used: false,
      used_by: '',
    };
    const updated = [...inviteCodes, newCode];
    saveInviteCodes(updated);
    setInviteCodes(updated);
    setLatestCode(newCode.code);
    message.success('邀请码生成成功');
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      message.success('邀请码已复制到剪贴板');
    }).catch(() => {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      message.success('邀请码已复制到剪贴板');
    });
  };

  const inviteColumns: ColumnsType<InviteCode> = [
    {
      title: '邀请码',
      dataIndex: 'code',
      key: 'code',
      width: 200,
      render: (code: string) => (
        <Space>
          <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold', letterSpacing: 2 }}>
            {code}
          </span>
          <Button
            type="link"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(code)}
            size="small"
          />
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (time: string) => time ? new Date(time).toLocaleString('zh-CN') : '-',
    },
    {
      title: '状态',
      dataIndex: 'used',
      key: 'used',
      width: 100,
      render: (used: boolean) => used
        ? <Tag color="red">已使用</Tag>
        : <Tag color="green">未使用</Tag>,
    },
    {
      title: '使用者',
      dataIndex: 'used_by',
      key: 'used_by',
      width: 150,
      render: (usedBy: string) => usedBy || '-',
    },
  ];

  return (
    <div style={{ marginTop: 32 }}>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0 }}>邀请管理</h3>
        <Button type="primary" icon={<LinkOutlined />} onClick={handleGenerate}>
          生成邀请码
        </Button>
      </div>

      {latestCode && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ color: '#52c41a', fontWeight: 500 }}>最新邀请码：</span>
          <Input
            value={latestCode}
            readOnly
            style={{
              width: 200,
              fontFamily: 'monospace',
              fontSize: 18,
              fontWeight: 'bold',
              letterSpacing: 3,
              textAlign: 'center',
            }}
          />
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(latestCode)}
          >
            复制邀请码
          </Button>
        </div>
      )}

      <Table
        columns={inviteColumns}
        dataSource={inviteCodes}
        rowKey="code"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 600 }}
        locale={{ emptyText: '暂无邀请码，点击「生成邀请码」按钮创建' }}
      />
    </div>
  );
};

export default PermissionManager;
