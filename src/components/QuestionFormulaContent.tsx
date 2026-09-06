// encoding: utf-8
import React from 'react';
import katex from 'katex';

/** Keep unresolved imported formulae visible without treating Word package paths as URLs. */
export const QuestionFormulaContent: React.FC<{ latex: string; block?: boolean }> = ({ latex, block = false }) => {
  if (!latex.trim()) return <span className="question-formula-pending" role="status" title={'\u8fd9\u6761\u516c\u5f0f\u5c1a\u672a\u8f6c\u6362\uff0c\u8bf7\u5bf9\u7167\u539f\u7a3f\u8865\u5168\u3002'}>{'[\u516c\u5f0f\u5f85\u8865\u5168]'}</span>;
  return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { throwOnError: false, displayMode: block, trust: false }) }} />;
};
