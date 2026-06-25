import { useMemo, useState } from 'react';
import { View, Text, Input, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { createMiniappTask, getMiniappTaskResult } from '../../utils/api';
import './index.scss';

type PaperAction = 'question-paper' | 'paper-export-word' | 'paper-export-pdf';

const actionCopy: Record<PaperAction, { button: string; success: string }> = {
  'question-paper': { button: '生成组卷', success: '组卷已创建' },
  'paper-export-word': { button: '导出 Word', success: 'Word 导出已开始' },
  'paper-export-pdf': { button: '导出 PDF', success: 'PDF 导出已开始' },
};

export default function QuestionBankPage() {
  const [title, setTitle] = useState('练习试卷');
  const [subject, setSubject] = useState('');
  const [questionCount, setQuestionCount] = useState('20');
  const [submittingAction, setSubmittingAction] = useState<PaperAction | null>(null);
  const [lastTaskId, setLastTaskId] = useState('');
  const [taskStatus, setTaskStatus] = useState('');
  const [taskResultText, setTaskResultText] = useState('');
  const [resultFileUrl, setResultFileUrl] = useState('');

  const normalizedCount = useMemo(() => {
    const count = Number.parseInt(questionCount, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }, [questionCount]);

  const submit = async (taskType: PaperAction) => {
    if (!title.trim()) {
      Taro.showToast({ title: '请输入试卷名称', icon: 'none' });
      return;
    }
    if (normalizedCount <= 0) {
      Taro.showToast({ title: '请输入题目数量', icon: 'none' });
      return;
    }

    setSubmittingAction(taskType);
    try {
      const res = await createMiniappTask(taskType, {
        title: title.trim(),
        subject: subject.trim(),
        questionCount: normalizedCount,
      });

      if (res.success) {
        const taskId = res.task?.id || res.data?.task?.id || '';
        setLastTaskId(taskId);
        setTaskStatus(res.task?.status || res.data?.task?.status || 'pending_host');
        setTaskResultText('');
        setResultFileUrl('');
        Taro.showToast({ title: actionCopy[taskType].success, icon: 'success' });
      } else {
        Taro.showToast({ title: res.error || '操作失败', icon: 'none' });
      }
    } catch {
      Taro.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
    } finally {
      setSubmittingAction(null);
    }
  };

  const isSubmitting = (taskType: PaperAction) => submittingAction === taskType;
  const createPaper = () => submit('question-paper');
  const exportWord = () => submit('paper-export-word');
  const exportPdf = () => submit('paper-export-pdf');
  const refreshTaskResult = async () => {
    if (!lastTaskId) {
      Taro.showToast({ title: '暂无可查询记录', icon: 'none' });
      return;
    }
    try {
      const res = await getMiniappTaskResult(lastTaskId);
      const task = res.task || res.data?.task;
      if (!res.success || !task) {
        Taro.showToast({ title: '未查询到结果', icon: 'none' });
        return;
      }
      setTaskStatus(task.status || '');
      const result = task.result_payload || {};
      setTaskResultText(result.fileName || result.title || result.error || '');
      setResultFileUrl(result.fileUrl || '');
    } catch {
      Taro.showToast({ title: '查询失败，请稍后重试', icon: 'none' });
    }
  };

  const openResultFile = async () => {
    if (!resultFileUrl) {
      Taro.showToast({ title: '暂无可打开文件', icon: 'none' });
      return;
    }
    try {
      const downloaded = await Taro.downloadFile({ url: resultFileUrl });
      if (downloaded.statusCode !== 200) throw new Error('download failed');
      await Taro.openDocument({
        filePath: downloaded.tempFilePath,
        showMenu: true,
      });
    } catch {
      Taro.showToast({ title: '文件打开失败', icon: 'none' });
    }
  };

  const actions: Array<{ taskType: PaperAction; onClick: () => void }> = [
    { taskType: 'question-paper', onClick: createPaper },
    { taskType: 'paper-export-word', onClick: exportWord },
    { taskType: 'paper-export-pdf', onClick: exportPdf },
  ];

  return (
    <View className="question-bank-page">
      <View className="hero-card">
        <Text className="hero-title">题库组卷与导出</Text>
        <Text className="hero-subtitle">选择组卷参数后，可生成试卷并导出 Word 或 PDF。</Text>
      </View>

      <View className="form-card">
        <View className="form-row">
          <Text className="field-label">试卷名称</Text>
          <Input
            className="field-input"
            value={title}
            placeholder="请输入试卷名称"
            onInput={(event) => setTitle(event.detail.value)}
          />
        </View>

        <View className="form-row">
          <Text className="field-label">科目</Text>
          <Input
            className="field-input"
            value={subject}
            placeholder="可选"
            onInput={(event) => setSubject(event.detail.value)}
          />
        </View>

        <View className="form-row">
          <Text className="field-label">题目数量</Text>
          <Input
            className="field-input"
            type="number"
            value={questionCount}
            placeholder="请输入题目数量"
            onInput={(event) => setQuestionCount(event.detail.value)}
          />
        </View>
      </View>

      <View className="action-card">
        {actions.map(({ taskType, onClick }) => (
          <Button
            key={taskType}
            className={`action-button ${taskType}`}
            loading={isSubmitting(taskType)}
            disabled={Boolean(submittingAction)}
            onClick={onClick}
          >
            {actionCopy[taskType].button}
          </Button>
        ))}
      </View>

      {lastTaskId ? (
        <View className="result-card">
          <View className="result-row">
            <Text className="result-label">最近记录</Text>
            <Text className="result-value">{lastTaskId}</Text>
          </View>
          <View className="result-row">
            <Text className="result-label">状态</Text>
            <Text className="result-value">{taskStatus || '处理中'}</Text>
          </View>
          {taskResultText ? (
            <Text className="result-text">{taskResultText}</Text>
          ) : null}
          <Button className="result-button" onClick={refreshTaskResult}>查看结果</Button>
          {resultFileUrl ? (
            <Button className="result-button result-open-button" onClick={openResultFile}>打开文件</Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
