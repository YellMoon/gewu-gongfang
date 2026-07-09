import { useEffect, useMemo, useState } from 'react';
import { View, Text, Input, Button, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { createMiniappTask, getMiniappTaskResult, readCloudSnapshot } from '../../utils/api';
import { getCachedList, setCachedList } from '../../utils/storage';
import './index.scss';

type PaperAction = 'question-paper' | 'paper-export-word' | 'paper-export-pdf';

interface QuestionPreview {
  id: string;
  stem?: string;
  content?: string;
  answer?: string;
  explanation?: string;
  analysis?: string;
  subject?: string;
  type?: string;
  difficulty?: number;
  source?: string;
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuestions(payload?: Record<string, any>): QuestionPreview[] {
  const questions = Array.isArray(payload?.questions) ? payload?.questions : [];
  const contentByQuestionId = new Map<string, any>();
  for (const content of Array.isArray(payload?.question_contents) ? payload?.question_contents : []) {
    const questionId = content.question_id || content.questionId;
    if (questionId && !contentByQuestionId.has(questionId)) contentByQuestionId.set(questionId, content);
  }
  return questions.map((question: any) => {
    const content = contentByQuestionId.get(question.id) || {};
    return {
      ...question,
      stem: question.stem || question.content || content.stem || '',
      answer: question.answer || content.answer || '',
      explanation: question.explanation || question.analysis || content.explanation || '',
    };
  });
}

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
  const [searchText, setSearchText] = useState('');
  const [questions, setQuestions] = useState<QuestionPreview[]>([]);
  const [questionLoading, setQuestionLoading] = useState(false);

  useEffect(() => {
    loadQuestionPreview();
  }, []);

  const normalizedCount = useMemo(() => {
    const count = Number.parseInt(questionCount, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }, [questionCount]);

  const filteredQuestions = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const source = questions.slice(0, 80);
    if (!keyword) return source.slice(0, 12);
    return source
      .filter(question => [
        question.stem,
        question.content,
        question.answer,
        question.explanation,
        question.analysis,
        question.subject,
        question.type,
        question.source,
      ].some(value => stripHtml(String(value || '')).toLowerCase().includes(keyword)))
      .slice(0, 12);
  }, [questions, searchText]);

  const loadQuestionPreview = async () => {
    const cached = getCachedList<QuestionPreview>('questions');
    if (cached.length > 0) setQuestions(cached);
    setQuestionLoading(true);
    try {
      const res = await readCloudSnapshot('full');
      const payload = res as any;
      const nextSnapshot = payload.snapshot || payload.data?.snapshot || null;
      const nextQuestions = normalizeQuestions(nextSnapshot?.payload);
      if (nextQuestions.length > 0) {
        setCachedList('questions', nextQuestions as any);
        setQuestions(nextQuestions);
      }
    } catch {
      if (cached.length === 0) setQuestions([]);
    } finally {
      setQuestionLoading(false);
    }
  };

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
        const payload = res as any;
        const task = payload.task || payload.data?.task;
        const taskId = task?.id || '';
        setLastTaskId(taskId);
        setTaskStatus(task?.status || 'pending_host');
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
      const payload = res as any;
      const task = payload.task || payload.data?.task;
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

      <View className="preview-card">
        <View className="preview-header">
          <View>
            <Text className="preview-title">{'\u8bd5\u9898\u9884\u89c8'}</Text>
            <Text className="preview-subtitle">{'\u4ec5\u5c55\u793a\u4e3b\u673a\u5df2\u53d1\u5e03\u7684\u53ef\u7528\u9898\u76ee'}</Text>
          </View>
          <Button className="preview-refresh" loading={questionLoading} onClick={loadQuestionPreview}>
            {'\u5237\u65b0'}
          </Button>
        </View>
        <Input
          className="preview-search"
          value={searchText}
          placeholder={'\u641c\u7d22\u9898\u5e72\u3001\u7b54\u6848\u6216\u6765\u6e90'}
          onInput={(event) => setSearchText(event.detail.value)}
        />
        <ScrollView className="question-preview-list" scrollY>
          {filteredQuestions.length > 0 ? filteredQuestions.map((question, index) => (
            <View key={question.id || index} className="question-preview-item">
              <View className="question-preview-meta">
                <Text>{question.subject || '\u672a\u5206\u79d1'}</Text>
                <Text>{question.type || '\u9898\u76ee'}</Text>
                {question.difficulty ? <Text>{'\u96be\u5ea6'} {question.difficulty}</Text> : null}
              </View>
              <Text className="question-preview-stem">
                {stripHtml(question.stem || question.content || '\u6682\u65e0\u9898\u5e72')}
              </Text>
              {(question.answer || question.explanation || question.analysis) ? (
                <View className="question-preview-answer">
                  {question.answer ? <Text>{'\u7b54\u6848\uff1a'}{stripHtml(question.answer)}</Text> : null}
                  {(question.explanation || question.analysis) ? (
                    <Text>{'\u89e3\u6790\uff1a'}{stripHtml(question.explanation || question.analysis)}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          )) : (
            <View className="question-preview-empty">
              <Text>{questionLoading ? '\u6b63\u5728\u52a0\u8f7d\u8bd5\u9898' : '\u6682\u65e0\u53ef\u9884\u89c8\u8bd5\u9898'}</Text>
            </View>
          )}
        </ScrollView>
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
