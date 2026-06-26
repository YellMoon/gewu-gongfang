import React, { useEffect, useState } from 'react';
import { Alert, Card, Button, message, Space, Divider, Popconfirm, Typography, Table, Tag, Form, Input, Select } from 'antd';
import { CloudDownloadOutlined, CloudSyncOutlined, ExportOutlined, ImportOutlined, DeleteOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { APP_VERSION } from '../generated/version';
import {
  getRuntimeConfig,
  saveRuntimeConfig,
  selectFolder,
  type RuntimeConfig,
} from '../services/runtimeConfigClient';

const { Text } = Typography;

type BackupJob = {
  id: string;
  status: string;
  affectedRows: number;
  artifactPath?: string;
  ossUrl?: string;
  scheduleCron?: string;
  retentionDays?: number;
  createdAt: string;
  finishedAt?: string;
  restoredAt?: string;
};

type QuestionBankStorageStatus = {
  configured?: boolean;
  available?: boolean;
  writable?: boolean;
  root?: string;
  configuredRoot?: string;
  pathChanged?: boolean;
  nodeRole?: string;
  reason?: string;
  detail?: string;
  manifest?: {
    storeId?: string;
    schemaVersion?: number;
    lastMountedByDeviceId?: string;
    lastVerifiedAt?: string;
  };
  candidateRoots?: string[];
};

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001/api';
const QUESTION_BANK_STORAGE_STATUS_PATH = '/api/question-bank/storage/status';
const apiOrigin = API_BASE.replace(/\/api\/?$/, '');

const SystemSettings: React.FC = () => {
  const dbService = (window as any).dbService;
  const [runtimeForm] = Form.useForm<RuntimeConfig>();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [questionBankStorageStatus, setQuestionBankStorageStatus] = useState<QuestionBankStorageStatus | null>(null);
  const [questionBankStorageLoading, setQuestionBankStorageLoading] = useState(false);
  const [backupJobs, setBackupJobs] = useState<BackupJob[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);

  const loadBackupJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/backups?limit=20`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '加载备份任务失败');
      setBackupJobs(json.jobs || []);
    } catch (error: any) {
      message.warning(error.message || '备份任务暂不可用');
    }
  };

  useEffect(() => {
    loadBackupJobs();
    loadRuntimeConfig();
    loadQuestionBankStorageStatus();
  }, []);

  const loadRuntimeConfig = async () => {
    try {
      const config = await getRuntimeConfig();
      setRuntimeConfig(config);
      runtimeForm.setFieldsValue(config);
    } catch (error: any) {
      message.warning(error.message || '运行配置暂不可用');
    }
  };

  const handleSaveRuntimeConfig = async () => {
    setRuntimeLoading(true);
    try {
      const values = await runtimeForm.validateFields();
      const saved = await saveRuntimeConfig(values);
      setRuntimeConfig(saved);
      runtimeForm.setFieldsValue(saved);
      message.success('数据主机与同步配置已保存，重启软件后生效');
    } catch (error: any) {
      message.error(error.message || '保存运行配置失败');
    } finally {
      setRuntimeLoading(false);
    }
  };

  const selectMainDbFolder = async () => {
    const folder = await selectFolder();
    if (folder) runtimeForm.setFieldValue('mainDbPath', `${folder}\\scheduling.db`);
  };

  const selectQuestionBankFolder = async () => {
    const folder = await selectFolder();
    if (folder) {
      runtimeForm.setFieldValue('questionBankPath', folder);
      runtimeForm.setFieldValue('questionAssetPath', `${folder}\\assets`);
      runtimeForm.setFieldValue('questionBankCandidatePaths', [folder]);
    }
  };

  const selectLocalCacheFolder = async () => {
    const folder = await selectFolder();
    if (folder) runtimeForm.setFieldValue('localCachePath', folder);
  };

  const selectNasBackupFolder = async () => {
    const folder = await selectFolder();
    if (folder) runtimeForm.setFieldValue('nasBackupPath', folder);
  };

  const loadQuestionBankStorageStatus = async () => {
    setQuestionBankStorageLoading(true);
    try {
      const res = await fetch(`${apiOrigin}${QUESTION_BANK_STORAGE_STATUS_PATH}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '加载题库盘状态失败');
      setQuestionBankStorageStatus(data.status || null);
      const storeId = data.status?.manifest?.storeId;
      if (storeId) runtimeForm.setFieldValue('questionBankStoreId', storeId);
    } catch (error: any) {
      setQuestionBankStorageStatus({
        available: false,
        writable: false,
        reason: error.message || '题库盘状态暂不可用',
      });
    } finally {
      setQuestionBankStorageLoading(false);
    }
  };

  const handleCreateServerBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch(`${API_BASE}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: 30, scheduleCron: 'manual' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '创建备份失败');
      message.success('服务端快照已完成');
      await loadBackupJobs();
    } catch (error: any) {
      message.error(error.message || '创建备份失败');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadBackup = (id: string) => {
    window.open(`${API_BASE}/backups/${id}/download`, '_blank');
  };

  const handleRestoreBackup = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/backups/${id}/restore`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '恢复失败');
      message.success(`恢复完成，导入 ${json.result?.total || 0} 条数据`);
      await loadBackupJobs();
    } catch (error: any) {
      message.error(error.message || '恢复失败');
    }
  };

  const handleResetData = () => {
    if (!dbService) {
      message.error('系统尚未加载完成');
      return;
    }
    try {
      const defaultData = {
        students: [],
        grades: [],
        courses: [],
        schedules: [],
        enrollments: [],
        payments: [],
        consumptions: [],
        institutions: [],
        schools: [],
        teachers: []
      };
      dbService.importAllData(defaultData);
      message.success('数据重置成功');
    } catch (error: any) {
      message.error(`重置失败：${error.message}`);
    }
  };

  const handleExport = () => {
    if (!dbService) {
      message.error('系统尚未加载完成');
      return;
    }
    try {
      const data = dbService.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('本地数据导出成功');
    } catch (error: any) {
      message.error(`导出失败：${error.message}`);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event: any) => {
        try {
          const data = JSON.parse(event.target.result);
          dbService.importAllData(data);
          message.success('本地数据导入成功');
        } catch (error: any) {
          message.error(`导入失败：${error.message}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div>
      <Card title="数据主机与同步" style={{ marginBottom: 16 }}>
        <Alert
          type={runtimeConfig?.nodeRole === 'primary-host' ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={runtimeConfig?.nodeRole === 'primary-host' ? '当前配置为本地数据主机' : '当前配置为普通离线客户端'}
          description="本地数据主机保存权威数据和题库移动硬盘；普通离线客户端可断网修改，联网后经确认同步到主机。"
        />
        <Alert
          type={questionBankStorageStatus?.available ? 'success' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={questionBankStorageStatus?.available ? '题库 SSD 在线' : '题库 SSD 未连接或不可用'}
          description={(
            <Space direction="vertical" size={2}>
              <span>当前路径：{questionBankStorageStatus?.root || runtimeConfig?.questionBankPath || '-'}</span>
              <span>storeId：{questionBankStorageStatus?.manifest?.storeId || runtimeConfig?.questionBankStoreId || '-'}</span>
              <span>写入状态：{questionBankStorageStatus?.writable ? '可写' : '保护/不可写'}</span>
              {questionBankStorageStatus?.pathChanged && <span>已通过 manifest 自动识别盘符变化。</span>}
              {(questionBankStorageStatus?.reason || questionBankStorageStatus?.detail) && (
                <span>{questionBankStorageStatus.reason || questionBankStorageStatus.detail}</span>
              )}
            </Space>
          )}
          action={(
            <Button size="small" loading={questionBankStorageLoading} onClick={loadQuestionBankStorageStatus}>
              检测题库盘
            </Button>
          )}
        />
        <Form form={runtimeForm} layout="vertical">
          <Form.Item name="nodeRole" label="运行角色" rules={[{ required: true }]}>
            <Select
              options={[
                { label: '本地数据主机', value: 'primary-host' },
                { label: '普通离线客户端', value: 'desktop-client' },
              ]}
            />
          </Form.Item>
          <Form.Item name="deviceId" label="设备 ID" rules={[{ required: true }]}>
            <Input disabled />
          </Form.Item>
          <Form.Item name="mainDbPath" label="主数据库路径" rules={[{ required: true }]}>
            <Input
              addonAfter={(
                <Button size="small" onClick={selectMainDbFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Form.Item name="questionBankPath" label="题库移动硬盘路径">
            <Input
              addonAfter={(
                <Button size="small" onClick={selectQuestionBankFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Form.Item name="questionAssetPath" label="题库附件路径">
            <Input />
          </Form.Item>
          <Form.Item name="hostBaseUrl" label="本地数据主机地址">
            <Input placeholder="http://192.168.1.10:3001" />
          </Form.Item>
          <Form.Item name="cloudBaseUrl" label="阿里云服务地址">
            <Input placeholder="https://your-domain.example.com" />
          </Form.Item>
          <Form.Item name="questionBankCandidatePaths" label="题库盘候选路径（支持热插拔/盘符变化）">
            <Select mode="tags" tokenSeparators={[';']} placeholder="例如 I:/GewuQuestionBank；换 Type-C 后可加入 J:/GewuQuestionBank" />
          </Form.Item>
          <Form.Item name="questionBankStoreId" label="题库盘 storeId">
            <Input disabled placeholder="初始化题库盘后自动读取 manifest.storeId" />
          </Form.Item>
          <Form.Item name="localCachePath" label="本机题库缓存/最近备份路径">
            <Input
              addonAfter={(
                <Button size="small" onClick={selectLocalCacheFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Form.Item name="nasBackupPath" label="NAS 备份/归档路径">
            <Input
              placeholder="例如 \\\\NAS\\GewuQuestionBankBackup"
              addonAfter={(
                <Button size="small" onClick={selectNasBackupFolder}>
                  选择
                </Button>
              )}
            />
          </Form.Item>
          <Button type="primary" loading={runtimeLoading} onClick={handleSaveRuntimeConfig}>
            保存数据主机与同步配置
          </Button>
        </Form>
      </Card>

      <Card title="数据管理" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Button type="primary" icon={<ExportOutlined />} size="large" onClick={handleExport}>
            导出本地数据
          </Button>
          <Button icon={<ImportOutlined />} size="large" onClick={handleImport}>
            导入本地备份
          </Button>
          <Button icon={<CloudSyncOutlined />} size="large" loading={backupLoading} onClick={handleCreateServerBackup}>
            创建服务端快照
          </Button>
          <Button icon={<ReloadOutlined />} size="large" onClick={handleResetData}>
            重置所有数据
          </Button>
          <Popconfirm
            title="确定要清除所有数据吗？"
            description="此操作不可恢复。建议先创建服务端快照或导出本地备份。"
            onConfirm={() => {
              const emptyData = {
                students: [],
                grades: [],
                courses: [],
                schedules: [],
                enrollments: [],
                payments: [],
                consumptions: [],
                institutions: [],
                schools: [],
                teachers: []
              };
              dbService.importAllData(emptyData);
              message.success('数据已清除');
            }}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />} size="large">
              清除所有数据
            </Button>
          </Popconfirm>
        </Space>
        <Divider />
        <Text type="secondary">
          服务端快照写入后端 backup 目录，并在归档任务表记录状态；定时备份可调用 scripts/backup-archive.js，数据湖目录由 DATA_LAKE_DIR 配置。
        </Text>
      </Card>

      <Card title="服务端备份与恢复" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={backupJobs}
          pagination={{ pageSize: 5 }}
          columns={[
            {
              title: '状态',
              dataIndex: 'status',
              render: (status: string) => <Tag color={status === 'finished' || status === 'restored' ? 'green' : status === 'failed' ? 'red' : 'blue'}>{status}</Tag>,
            },
            {
              title: '数据量',
              dataIndex: 'affectedRows',
            },
            {
              title: '保留天数',
              dataIndex: 'retentionDays',
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (value: string) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
            },
            {
              title: '操作',
              render: (_, record: BackupJob) => (
                <Space>
                  <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => handleDownloadBackup(record.id)}>
                    下载
                  </Button>
                  <Popconfirm
                    title="确认从该快照恢复？"
                    description="恢复会覆盖同 ID 数据，执行前请确认已保存当前状态。"
                    onConfirm={() => handleRestoreBackup(record.id)}
                    okText="恢复"
                    cancelText="取消"
                  >
                    <Button size="small" icon={<RollbackOutlined />}>
                      恢复
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title="系统信息">
        <div style={{ color: '#666', lineHeight: '1.8' }}>
          <p>版本：{APP_VERSION}</p>
          <p>桌面数据：浏览器本地存储 IndexedDB/LocalStorage</p>
          <p>服务端备份：JSON 快照 + 归档任务状态 + 可选数据湖副本</p>
          <p>更新日期：{dayjs().format('YYYY-MM-DD')}</p>
          <p>软件作者：小龙虾</p>
        </div>
      </Card>
    </div>
  );
};

export default SystemSettings;
