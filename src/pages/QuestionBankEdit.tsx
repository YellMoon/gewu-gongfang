import React from 'react';
import QuestionBankPreview from './QuestionBankPreview';

const QuestionBankEdit: React.FC<{ subject?: string; context?: { questionId?: string; questionIds?: string[] } }> = ({ subject, context }) => <QuestionBankPreview subject={subject} context={context} taggingWorkspace />;
export default QuestionBankEdit;
