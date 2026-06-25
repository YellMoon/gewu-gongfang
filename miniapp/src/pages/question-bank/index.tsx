import { useMemo, useState } from 'react';
import { View, Text, Input, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { createMiniappTask } from '../../utils/api';
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
    </View>
  );
}
