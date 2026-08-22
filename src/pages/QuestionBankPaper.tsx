import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Input as AntdInput,
  InputNumber as AntdInputNumber,
  Checkbox,
  Radio,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  App as AntdApp,
  Alert,
  Progress,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  FileWordOutlined,
  PlusOutlined,
  SplitCellsOutlined,
  ReloadOutlined,
  StopOutlined,
  RedoOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { Question } from '../types';
import { getApiBase } from '../utils/apiBase';
import { normalizeQuestionType } from '../constants/questionTypes';
import { QUESTION_BASKET_SELECTED_STORAGE_KEY, QUESTION_BASKET_STORAGE_KEY } from '../components/QuestionBasket';
import QuestionRichContent from '../components/QuestionRichContent';
import QuestionRenderer from '../components/QuestionRenderer';
import type { AnswerPosition, FormulaExportMode, PaperArtifactFormat } from '../services/hostPaperExport';
import { getRuntimeConfig, RuntimeConfig } from '../services/runtimeConfigClient';
import {
  cancelPaperExportTask, downloadPaperExportTask, loadPaperExportTasks, refreshPaperExportTask,
  refreshPendingPaperExportTasks, retryPaperExportTask, submitPaperExportTask,
} from '../services/paperExportTaskService';
import type { PaperExportTaskRecord } from '../services/paperExportTaskService';
import { getPaperExportTaskPresentation } from '../services/paperExportTaskPresentation.mjs';
import './QuestionBankPaper.css';

const API_BASE = getApiBase('/api/question-bank');

const TASK_TEXT = {
  submit: '\u63d0\u4ea4\u4e91\u7aef\u4efb\u52a1',
  submitPdf: '\u63d0\u4ea4 PDF \u5bfc\u51fa\u4efb\u52a1',
  submitted: '\u5df2\u63d0\u4ea4\u4e91\u7aef\uff0c\u53ef\u5728\u4efb\u52a1\u8bb0\u5f55\u4e2d\u67e5\u770b\u8fdb\u5ea6',
  directDone: '\u4e91\u7aef\u5df2\u5b8c\u6210\u5bfc\u51fa',
  localDraft: '\u7f51\u7edc\u672a\u786e\u8ba4\uff0c\u5df2\u4fdd\u5b58\u4e3a\u672c\u5730\u8349\u7a3f\uff0c\u8054\u7f51\u540e\u8bf7\u786e\u8ba4\u63d0\u4ea4\u4e91\u7aef',
  noCloud: '\u4e91\u7aef\u4efb\u52a1\u670d\u52a1\u6682\u4e0d\u53ef\u7528\uff0c\u4efb\u52a1\u5df2\u4fdd\u5b58\u4e3a\u672c\u5730\u8349\u7a3f',
  configError: '\u65e0\u6cd5\u8bfb\u53d6\u684c\u9762\u8fd0\u884c\u914d\u7f6e\uff0c\u53ea\u80fd\u7ee7\u7eed\u7f16\u8f91\u8bd5\u5377\u3002',
  historyTitle: '\u5bfc\u51fa\u4efb\u52a1\u8bb0\u5f55', cancel: '\u53d6\u6d88\u4efb\u52a1',
  retry: '\u4f7f\u7528\u65b0\u8bf7\u6c42\u91cd\u8bd5', refreshDownload: '\u5237\u65b0\u5e76\u4e0b\u8f7d', refresh: '\u5237\u65b0\u72b6\u6001',
};

const LabeledInput: React.FC<React.ComponentProps<typeof AntdInput>> = ({ addonBefore, ...props }) => addonBefore ? (
  <Space.Compact block className="paper-editor-labeled-field">
    <Typography.Text className="paper-editor-field-label">{addonBefore}</Typography.Text>
    <AntdInput {...props} />
  </Space.Compact>
) : <AntdInput {...props} />;

const LabeledInputNumber: React.FC<React.ComponentProps<typeof AntdInputNumber>> = ({ addonBefore, ...props }) => addonBefore ? (
  <Space.Compact block className="paper-editor-labeled-field">
    <Typography.Text className="paper-editor-field-label">{addonBefore}</Typography.Text>
    <AntdInputNumber {...props} />
  </Space.Compact>
) : <AntdInputNumber {...props} />;

const Input = LabeledInput;
const InputNumber = LabeledInputNumber;

interface PaperQuestion {
  uid: string;
  question: Question;
  sectionTitle: string;
  score: number;
}

const DEFAULT_SECTION_BY_TYPE: Record<string, string> = {
  单选题: '一、单选题',
  多选题: '二、多选题',
  判断题: '三、判断题',
  实验题: '四、实验题',
  解答题: '五、解答题',
};

function todayTitle(): string {
  return `${new Date().toISOString().slice(0, 10)}试卷`;
}

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    difficulty: Number(row.difficulty || 1),
    content: row.content ?? row.stem ?? '',
    answer: row.answer ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
    assets: row.assets || [],
    formulas: row.formulas || [],
  } as Question;
}

async function loadBasketQuestions(ids: string[]): Promise<Question[]> {
  const db = (window as any).dbService;
  const localRows = (db?.getAllQuestions?.() || []).map(normalizeQuestion);
  const byId = new Map(localRows.map((q: Question) => [q.id, q]));

  try {
    const res = await fetch(`${API_BASE}/questions?limit=1000`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      data.data.map(normalizeQuestion).forEach((q: Question) => byId.set(q.id, q));
    }
  } catch (_err) {
    // Remote service is optional for the desktop paper editor.
  }

  return ids.map(id => byId.get(id)).filter((q): q is Question => !!q);
}

function buildInitialPaperQuestions(questions: Question[]): PaperQuestion[] {
  return questions.map((question, index) => {
    const type = normalizeQuestionType(question.type);
    return {
      uid: `${question.id}-${index}`,
      question: { ...question, type },
      sectionTitle: DEFAULT_SECTION_BY_TYPE[type] || '综合题',
      score: type === '单选题' || type === '判断题' ? 3 : 6,
    };
  });
}

function moveItem<T>(rows: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function renderSource(question: Question): string {
  const parts = [question.year, question.region, question.school, question.exam_type, question.source].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '未填写来源';
}

const QuestionBankPaper: React.FC = () => {
  const { message: messageApi } = AntdApp.useApp();
  const [title, setTitle] = useState(todayTitle());
  const [items, setItems] = useState<PaperQuestion[]>([]);
  const [answerPosition, setAnswerPosition] = useState<AnswerPosition>('end');
  const [includeDraft, setIncludeDraft] = useState(true);
  const [formulaMode, setFormulaMode] = useState<FormulaExportMode>('word-native');
  const [exportingFormat, setExportingFormat] = useState<PaperArtifactFormat | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [runtimeConfigError, setRuntimeConfigError] = useState('');
  const [paperTasks, setPaperTasks] = useState<PaperExportTaskRecord[]>(() => loadPaperExportTasks());
  const [taskBusyId, setTaskBusyId] = useState('');

  useEffect(() => {
    let mounted = true;
    getRuntimeConfig().then(config => {
      if (!mounted) return;
      setRuntimeConfig(config);
      setRuntimeConfigError('');
    }).catch(() => {
      if (!mounted) return;
      setRuntimeConfigError(TASK_TEXT.configError);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!runtimeConfig) return undefined;
    let mounted = true;
    const syncTasks = async () => {
      await refreshPendingPaperExportTasks(runtimeConfig);
      if (mounted) setPaperTasks(loadPaperExportTasks());
    };
    syncTasks().catch(() => undefined);
    const timer = window.setInterval(() => syncTasks().catch(() => undefined), 2500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [runtimeConfig]);

  useEffect(() => {
    let mounted = true;
    const selectedIds: string[] = JSON.parse(localStorage.getItem(QUESTION_BASKET_SELECTED_STORAGE_KEY) || '[]');
    const basketIds: string[] = JSON.parse(localStorage.getItem(QUESTION_BASKET_STORAGE_KEY) || '[]');
    const dbIds: string[] = (window as any).dbService?.getQuestionBasketIds?.() || [];
    const targetIds = selectedIds.length > 0 ? selectedIds : (dbIds.length > 0 ? dbIds : basketIds);
    loadBasketQuestions(targetIds).then(questions => {
      const visibleQuestions = includeDraft
        ? questions
        : questions.filter(question => (question.status || 'draft') === 'published');
      if (mounted) setItems(buildInitialPaperQuestions(visibleQuestions));
    });
    return () => {
      mounted = false;
    };
  }, [includeDraft]);

  const sectionOptions = useMemo(() => {
    const titles = Array.from(new Set([...Object.values(DEFAULT_SECTION_BY_TYPE), ...items.map(item => item.sectionTitle)]));
    return titles.map(title => ({ label: title, value: title }));
  }, [items]);

  const groupedItems = useMemo(() => {
    const groups: { title: string; rows: Array<PaperQuestion & { number: number; index: number }> }[] = [];
    items.forEach((item, index) => {
      const title = item.sectionTitle || '综合题';
      let group = groups.find(row => row.title === title);
      if (!group) {
        group = { title, rows: [] };
        groups.push(group);
      }
      group.rows.push({ ...item, number: index + 1, index });
    });
    return groups;
  }, [items]);

  const typeStats = useMemo(() => {
    const stats = new Map<string, number>();
    items.forEach(item => stats.set(item.question.type, (stats.get(item.question.type) || 0) + 1));
    return Array.from(stats.entries());
  }, [items]);

  const difficultyStats = useMemo(() => {
    const stats = new Map<number, number>();
    items.forEach(item => stats.set(item.question.difficulty || 1, (stats.get(item.question.difficulty || 1) || 0) + 1));
    return Array.from(stats.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  const totalScore = useMemo(() => items.reduce((sum, item) => sum + Number(item.score || 0), 0), [items]);

  const updateItem = (uid: string, patch: Partial<PaperQuestion>) => {
    setItems(prev => prev.map(item => item.uid === uid ? { ...item, ...patch } : item));
  };

  const move = (index: number, offset: number) => {
    setItems(prev => moveItem(prev, index, offset));
  };

  const applyAutoGroup = () => {
    setItems(prev => buildInitialPaperQuestions(prev.map(item => item.question)));
    messageApi.success('已按题型重新分组');
  };

  const exportHostPaper = async (format: PaperArtifactFormat) => {
    if (!runtimeConfig || exportingFormat) return;
    setExportingFormat(format);
    try {
      const submitted = await submitPaperExportTask(runtimeConfig, {
        title, format, formulaMode, questionIds: items.map(item => item.question.id),
        answerPosition, subject: items[0]?.question.subject || '',
      });
      setPaperTasks(loadPaperExportTasks());
      window.requestAnimationFrame(() => document.getElementById(`paper-task-${submitted.task.localId}`)?.focus());
      if (!submitted.accepted) {
        messageApi.warning(submitted.task.errorCode === 'CLOUD_TASK_UNAVAILABLE' ? TASK_TEXT.noCloud : TASK_TEXT.localDraft);
      } else if (submitted.task.status === 'completed') {
        await downloadPaperExportTask(runtimeConfig, submitted.task);
        messageApi.success(TASK_TEXT.directDone);
      } else messageApi.success(TASK_TEXT.submitted);
    } catch (error) {
      console.error('paper export task failed', error);
      const reason = error instanceof Error ? error.message : String.fromCharCode(35831, 31245, 21518, 37325, 35797);
      messageApi.error(`${String.fromCharCode(25968, 25454, 20027, 26426, 23548, 20986, 22833, 36133)}: ${reason}`);
    } finally {
      setExportingFormat(null);
    }
  };

  const reloadTasks = () => setPaperTasks(loadPaperExportTasks());

  const runTaskAction = async (task: PaperExportTaskRecord, action: 'refresh' | 'cancel' | 'retry' | 'download') => {
    if (!runtimeConfig || taskBusyId) return;
    setTaskBusyId(task.localId);
    try {
      if (action === 'cancel') await cancelPaperExportTask(runtimeConfig, task.localId);
      if (action === 'retry') {
        const retried = await retryPaperExportTask(runtimeConfig, task.localId);
        if (!retried.accepted) messageApi.warning(retried.task.errorCode === 'CLOUD_TASK_UNAVAILABLE' ? TASK_TEXT.noCloud : TASK_TEXT.localDraft);
      }
      if (action === 'refresh') await refreshPaperExportTask(runtimeConfig, task.localId);
      if (action === 'download') {
        const refreshed = task.serverTaskId ? await refreshPaperExportTask(runtimeConfig, task.localId) : task;
        await downloadPaperExportTask(runtimeConfig, refreshed);
      }
      reloadTasks();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      messageApi.error(reason === 'HOST_BASE_URL_REQUIRED' ? '\u8bf7\u5148\u5728\u7cfb\u7edf\u8bbe\u7f6e\u4e2d\u914d\u7f6e\u672c\u5730\u6570\u636e\u4e3b\u673a\u5730\u5740' : reason);
    } finally { setTaskBusyId(''); }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card
        title={
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            variant="borderless"
            style={{ maxWidth: 520, fontSize: 20, fontWeight: 600, paddingLeft: 0 }}
          />
        }
        extra={
          <Space wrap>
            <Select<FormulaExportMode> value={formulaMode} onChange={setFormulaMode} style={{ width: 210 }} options={[
              { value: 'word-native', label: String.fromCharCode(87, 111, 114, 100, 32, 33258, 24102, 20844, 24335) },
              { value: 'eq-field', label: String.fromCharCode(69, 81, 32, 22495, 20844, 24335) },
              { value: 'mathtype-compatible', label: String.fromCharCode(77, 97, 116, 104, 84, 121, 112, 101, 32, 20860, 23481, 30690, 37327) },
              { value: 'latex-vector', label: String.fromCharCode(76, 97, 84, 101, 88, 32, 30690, 37327, 20844, 24335) },
            ]} />
            <Checkbox checked={includeDraft} onChange={e => setIncludeDraft(e.target.checked)}>
              包含草稿/待审核题
            </Checkbox>
            <Space direction="vertical" size={2}>
              <Radio.Group value={answerPosition} onChange={e => setAnswerPosition(e.target.value)} disabled={!!exportingFormat}>
                <Radio.Button value="end">{String.fromCharCode(31572, 26696, 38598, 20013, 38468, 21518)}</Radio.Button>
                <Radio.Button value="after-each">{String.fromCharCode(36880, 39064, 26174, 31034, 31572, 26696)}</Radio.Button>
              </Radio.Group>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {answerPosition === 'end'
                  ? String.fromCharCode(31572, 26696, 38598, 20013, 38468, 22312, 35797, 39064, 21518, 65292, 21547, 36873, 25321, 39064, 27719, 24635, 12289, 30693, 35782, 28857, 21644, 35299, 26512, 12290)
                  : String.fromCharCode(27599, 39064, 21518, 32039, 36319, 31572, 26696, 12289, 30693, 35782, 28857, 21644, 35299, 26512, 65292, 19981, 20877, 29983, 25104, 23614, 37096, 31572, 26696, 21306, 12290)}
              </Typography.Text>
            </Space>
            <Button icon={<SplitCellsOutlined />} onClick={applyAutoGroup} disabled={items.length === 0}>
              按题型分组
            </Button>
            <Button onClick={() => exportHostPaper('pdf')} loading={exportingFormat === 'pdf'} disabled={items.length === 0 || !runtimeConfig || !!exportingFormat}>{TASK_TEXT.submitPdf}</Button>
            <Button type="primary" icon={<FileWordOutlined />} onClick={() => exportHostPaper('word')} loading={exportingFormat === 'word'} disabled={items.length === 0 || !runtimeConfig || !!exportingFormat} className="submit-to-cloud-word" aria-label={TASK_TEXT.submit}>
              导出试卷
            </Button>
          </Space>
        }
      >
        {runtimeConfigError && <Alert type="warning" showIcon message={runtimeConfigError} style={{ marginBottom: 12 }} />}
        <Space size={16} wrap>
          <Statistic title="题目数" value={items.length} suffix="题" />
          <Statistic title="总分" value={totalScore} suffix="分" />
          <div>
            <Typography.Text type="secondary">题型分布</Typography.Text>
            <div style={{ marginTop: 6 }}>
              {typeStats.length === 0 ? <Tag>暂无</Tag> : typeStats.map(([type, count]) => <Tag key={type} color="blue">{type} {count}</Tag>)}
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">难度分布</Typography.Text>
            <div style={{ marginTop: 6 }}>
              {difficultyStats.length === 0 ? <Tag>暂无</Tag> : difficultyStats.map(([level, count]) => <Tag key={level}>难度{level} {count}</Tag>)}
            </div>
          </div>
        </Space>
      </Card>

      {paperTasks.length > 0 && (
        <Card title={TASK_TEXT.historyTitle} extra={
          <Button icon={<ReloadOutlined />} onClick={() => runtimeConfig && refreshPendingPaperExportTasks(runtimeConfig).then(reloadTasks)}>
            {TASK_TEXT.refresh}
          </Button>
        }>
          <div aria-live="polite" className="paper-export-task-list">
            {paperTasks.map(task => {
              const presentation = getPaperExportTaskPresentation(task);
              const cancellable = Boolean(task.serverTaskId) && !['completed', 'failed', 'cancelled', 'timed_out'].includes(task.status);
              const retryable = ['draft', 'failed', 'timed_out'].includes(task.status);
              return (
                <div id={`paper-task-${task.localId}`} key={task.localId} tabIndex={-1} className="paper-export-task-card">
                  <div className="paper-export-task-summary">
                    <Space wrap>
                      <Tag color={presentation.color}>{presentation.label}</Tag>
                      <Typography.Text strong>{task.request.title}</Typography.Text>
                      <Tag>{task.request.format.toUpperCase()}</Tag>
                      <Typography.Text type="secondary">{task.request.questionIds.length} {String.fromCharCode(39064)}</Typography.Text>
                    </Space>
                    <Progress percent={task.progress || 0} size="small" status={task.status === 'failed' ? 'exception' : task.status === 'completed' ? 'success' : 'active'} />
                    {task.message && <Typography.Text type={task.status === 'failed' ? 'danger' : 'secondary'}>{task.message}</Typography.Text>}
                  </div>
                  <Space wrap className="paper-export-task-actions">
                    {cancellable && <Button icon={<StopOutlined />} loading={taskBusyId === task.localId} onClick={() => runTaskAction(task, 'cancel')}>{TASK_TEXT.cancel}</Button>}
                    {retryable && <Button icon={<RedoOutlined />} loading={taskBusyId === task.localId} onClick={() => runTaskAction(task, 'retry')}>{TASK_TEXT.retry}</Button>}
                    {task.status === 'completed' && <Button type="primary" icon={<DownloadOutlined />} loading={taskBusyId === task.localId} onClick={() => runTaskAction(task, 'download')}>{TASK_TEXT.refreshDownload}</Button>}
                  </Space>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <Empty description="试题篮中暂无已选试题，请先从试题库加入试题篮后再组卷" />
        </Card>
      ) : (
        groupedItems.map(group => (
          <Card
            key={group.title}
            title={group.title}
            extra={<Tag color="processing">{group.rows.length} 题</Tag>}
            styles={{ body: { paddingTop: 8 } }}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {group.rows.map(row => (
                <div
                  key={row.uid}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr 260px 80px',
                    gap: 12,
                    alignItems: 'start',
                    border: '1px solid #edf0f5',
                    borderRadius: 6,
                    padding: 12,
                    background: '#fff',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{row.number}</div>
                  <div style={{ minWidth: 0 }}>
                    <Space size={6} wrap style={{ marginBottom: 8 }}>
                      <Tag>{row.question.subject || '物理'}</Tag>
                      <Tag color="blue">{row.question.type}</Tag>
                      <Tag color={(row.question.status || 'draft') === 'published' ? 'green' : 'orange'}>{row.question.status || 'draft'}</Tag>
                      <Tag>难度{row.question.difficulty || 1}</Tag>
                      <Tag>{renderSource(row.question)}</Tag>
                    </Space>
                    <QuestionRenderer
                      content={row.question.content || '未填写题干'}
                      options={row.question.options as any[]}
                      questionType={row.question.type}
                    />
                    <QuestionRichContent question={row.question} />
                    {answerPosition === 'after-each' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #d9d9d9', color: '#455a64' }}>
                        <div><b>答案：</b>{row.question.answer || '未填写'}</div>
                        {row.question.analysis && <div><b>解析：</b>{row.question.analysis}</div>}
                      </div>
                    )}
                  </div>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Select
                      value={row.sectionTitle}
                      options={sectionOptions}
                      onChange={value => updateItem(row.uid, { sectionTitle: value })}
                      style={{ width: '100%' }}
                    />
                    <Input
                      addonBefore="新分组"
                      placeholder="输入后回车"
                      onPressEnter={e => {
                        const value = e.currentTarget.value.trim();
                        if (!value) return;
                        updateItem(row.uid, { sectionTitle: value });
                        e.currentTarget.value = '';
                      }}
                    />
                    <InputNumber
                      min={0}
                      precision={1}
                      addonBefore="分值"
                      value={row.score}
                      onChange={value => updateItem(row.uid, { score: Number(value || 0) })}
                      style={{ width: '100%' }}
                    />
                  </Space>
                  <Space direction="vertical">
                    <Button icon={<ArrowUpOutlined />} onClick={() => move(row.index, -1)} disabled={row.index === 0} />
                    <Button icon={<ArrowDownOutlined />} onClick={() => move(row.index, 1)} disabled={row.index === items.length - 1} />
                    <Button icon={<PlusOutlined />} onClick={() => updateItem(row.uid, { sectionTitle: '综合题' })}>综合</Button>
                  </Space>
                </div>
              ))}
            </Space>
          </Card>
        ))
      )}

      {answerPosition === 'end' && items.length > 0 && (
        <Card title="参考答案与解析">
          <Space direction="vertical" style={{ width: '100%' }}>
            {items.map((item, index) => (
              <div key={item.uid} style={{ lineHeight: 1.8 }}>
                <b>{index + 1}. </b>
                <span>答案：{item.question.answer || '未填写'}</span>
                {item.question.analysis && <div style={{ marginLeft: 24 }}>解析：{item.question.analysis}</div>}
              </div>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
};

export default QuestionBankPaper;
