import { useEffect, useRef, useState } from 'react';
import { View, Text, Input, Button, ScrollView, Checkbox, CheckboxGroup } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { unrecognizedExperienceApi, UnrecognizedQuestion, UnrecognizedTask } from '../../utils/unrecognizedExperience';
import { authSessionRuntime } from '../../utils/authSession';
import { isUnrecognizedIdentity } from '../../utils/accountExperience';
import { createSessionBoundOperation, openSessionBoundDocument } from '../../utils/miniappApiSessionRuntime';
import './index.scss';

type TaskType = 'question-paper' | 'paper-export-word' | 'paper-export-pdf';
type PageState = 'loading' | 'ready' | 'empty' | 'error';
const actionCopy: Record<TaskType, string> = {
  'question-paper': '创建组卷',
  'paper-export-word': '导出 Word',
  'paper-export-pdf': '导出 PDF',
};
const statusCopy: Record<string, string> = {
  pending_host: '等待数据主机',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
const answers = [
  { value: 'end', label: '答案统一置后' },
  { value: 'after-each', label: '答案逐题后' },
];
const formulas = [
  { value: 'word-native', label: 'Word native' },
  { value: 'eq-field', label: 'EQ field' },
  { value: 'mathtype-compatible', label: 'MathType' },
  { value: 'latex-vector', label: 'LaTeX vector' },
];

export default function UnrecognizedExperiencePanel() {
  const authorized = isUnrecognizedIdentity(Taro.getStorageSync('user_info'));
  const [pageState, setPageState] = useState<PageState>('loading');
  const [questions, setQuestions] = useState<UnrecognizedQuestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [title, setTitle] = useState('练习试卷');
  const [answerIndex, setAnswerIndex] = useState(0);
  const [formulaIndex, setFormulaIndex] = useState(0);
  const [tasks, setTasks] = useState<UnrecognizedTask[]>([]);
  const [submitting, setSubmitting] = useState<TaskType | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadQuestions = async () => {
    setPageState('loading');
    try {
      const list = await unrecognizedExperienceApi.getQuestions();
      setQuestions(list);
      setPageState(list.length ? 'ready' : 'empty');
    } catch {
      setPageState('error');
    }
  };

  const refreshTasks = async () => {
    const updated: UnrecognizedTask[] = [];
    for (const task of tasks) {
      if (task.status === 'pending_host' || task.status === 'processing') {
        try {
          const fresh = await unrecognizedExperienceApi.getTask(task.id);
          updated.push(fresh);
          continue;
        } catch { /* keep old */ }
      }
      updated.push(task);
    }
    if (updated.length) setTasks(updated);
  };

  useEffect(() => {
    if (!authorized) {
      Taro.reLaunch({ url: '/pages/login/index' });
      return undefined;
    }
    loadQuestions();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [authorized]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (tasks.some(t => t.status === 'pending_host' || t.status === 'processing')) {
      pollRef.current = setInterval(refreshTasks, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [tasks]);

  const filtered = questions.filter(q => {
    const key = searchText.trim().toLowerCase();
    return !key || `${q.stemRichContent} ${q.type}`.toLowerCase().includes(key);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const submit = async (taskType: TaskType) => {
    if (!title.trim()) {
      Taro.showToast({ title: '请输入试卷名称', icon: 'none' });
      return;
    }
    if (selectedIds.length === 0) {
      Taro.showToast({ title: '请至少选择一道题', icon: 'none' });
      return;
    }
    setSubmitting(taskType);
    try {
      const task = await unrecognizedExperienceApi.createTask({
        taskType,
        title: title.trim(),
        questionIds: selectedIds,
        answerPosition: answers[answerIndex].value,
        formulaMode: formulas[formulaIndex].value,
      });
      setTasks(prev => [task, ...prev]);
      Taro.showToast({ title: '任务已提交', icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '提交失败', icon: 'none' });
    } finally {
      setSubmitting(null);
    }
  };

  const cancelTask = async (task: UnrecognizedTask) => {
    try {
      await unrecognizedExperienceApi.cancelTask(task.id);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'cancelled', phase: 'cancelled' } : t));
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '取消失败', icon: 'none' });
    }
  };

  const downloadTask = async (task: UnrecognizedTask) => {
    if (task.status !== 'completed' || !task.result?.artifactId) {
      Taro.showToast({ title: '任务尚未完成或无产物', icon: 'none' });
      return;
    }
    try {
      const sessionBoundary = createSessionBoundOperation(authSessionRuntime);
      const file: any = await unrecognizedExperienceApi.downloadArtifact(task.result.artifactId);
      if (file.statusCode !== 200 || !file.tempFilePath) throw new Error('\u4e0b\u8f7d\u5931\u8d25');
      await openSessionBoundDocument(sessionBoundary, {
        filePath: file.tempFilePath,
        openDocument: (options: any) => Taro.openDocument(options),
        removeTemporaryFile: (filePath: string) => new Promise<void>(resolve => {
          try { Taro.getFileSystemManager().unlink({ filePath, complete: () => resolve() }); } catch (_error) { resolve(); }
        }),
      });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '下载失败', icon: 'none' });
    }
  };

  const goToApply = () => {
    Taro.navigateTo({ url: '/pages/account-application/index' });
  };

  const stateText = pageState === 'loading' ? '正在加载题目' : pageState === 'empty' ? '暂无可用题目' : '加载失败';

  return (
    <View className='unrecognized-page'>
      <View className='hero-card'>
        <Text className='hero-title'>体验组卷</Text>
        <Text className='hero-subtitle'>选择示例题目，提交组卷与导出任务</Text>
      </View>

      <View className='form-card'>
        <View className='form-row'>
          <Text className='field-label'>试卷名称</Text>
          <Input className='field-input' value={title} onInput={e => setTitle(e.detail.value)} />
        </View>
        <View className='picker-row' onClick={() => {
          Taro.showActionSheet({ itemList: answers.map(a => a.label), success: res => setAnswerIndex(res.tapIndex) });
        }}>
          <Text>{answers[answerIndex].label}</Text>
        </View>
        <View className='picker-row' onClick={() => {
          Taro.showActionSheet({ itemList: formulas.map(f => f.label), success: res => setFormulaIndex(res.tapIndex) });
        }}>
          <Text>{formulas[formulaIndex].label}</Text>
        </View>
      </View>

      <View className='preview-card'>
        <View className='preview-header'>
          <View>
            <Text className='preview-title'>选择题目 ({selectedIds.length})</Text>
          </View>
          <Button className='preview-refresh' onClick={loadQuestions}>刷新</Button>
        </View>
        <Input className='preview-search' value={searchText} onInput={e => setSearchText(e.detail.value)} placeholder='搜索题目' />
        {pageState !== 'ready' ? (
          <View className='question-preview-empty'>
            <Text>{stateText}</Text>
          </View>
        ) : (
          <ScrollView className='question-preview-list' scrollY>
            <CheckboxGroup onChange={e => setSelectedIds(e.detail.value)}>
              {filtered.map(q => (
                <View key={q.id} className={`question-preview-item ${selectedIds.includes(q.id) ? 'selected' : ''}`} onClick={() => toggleSelect(q.id)}>
                  <View className='question-preview-meta'>
                    <Text>{q.type}</Text>
                    <Text>#{q.number}</Text>
                  </View>
                  <Text className='question-preview-stem'>{q.stemRichContent}</Text>
                </View>
              ))}
            </CheckboxGroup>
          </ScrollView>
        )}
      </View>

      <View className='action-card'>
        {(Object.keys(actionCopy) as TaskType[]).map(a => (
          <Button
            key={a}
            className={`action-button ${a}`}
            loading={submitting === a}
            disabled={!!submitting || selectedIds.length === 0}
            onClick={() => submit(a)}
          >
            {actionCopy[a]}
          </Button>
        ))}
      </View>

      <View className='result-card'>
        <View className='preview-header'>
          <Text className='preview-title'>任务记录</Text>
          <Button className='preview-refresh' onClick={refreshTasks}>刷新</Button>
        </View>
        {tasks.length === 0 ? (
          <Text className='result-text'>暂无任务</Text>
        ) : (
          tasks.map(task => (
            <View key={task.id} className='task-item'>
              <Text className='result-text'>{task.request?.payload?.title || task.id}</Text>
              <Text className='result-value'>{statusCopy[task.status] || task.status} / {task.phase} / {task.progress}%</Text>
              {task.error ? <Text className='task-error'>{task.error}</Text> : null}
              <View className='task-actions'>
                {task.status === 'pending_host' || task.status === 'processing' ? (
                  <Button size='mini' onClick={() => cancelTask(task)}>取消</Button>
                ) : null}
                {task.status === 'failed' ? (
                  <Button size='mini' onClick={() => submit(task.request?.taskType || 'question-paper')}>重试</Button>
                ) : null}
                {task.status === 'completed' && task.result?.artifactId ? (
                  <Button size='mini' onClick={() => downloadTask(task)}>下载</Button>
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>

      <View className='apply-card'>
        <Button className='apply-button' onClick={goToApply}>申请正式账号</Button>
      </View>
    </View>
  );
}
