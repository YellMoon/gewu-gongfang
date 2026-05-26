import React from 'react';
import QuestionRichText from './QuestionRichText';
import { columnsForOptions, normalizeOptions } from '../utils/questionOptions';

const QuestionOptionsView: React.FC<{
  options?: any[];
  terms?: string[];
}> = ({ options = [], terms = [] }) => {
  const normalizedRows = normalizeOptions(options);
  if (normalizedRows.length === 0) return null;

  const columns = columnsForOptions(normalizedRows);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        columnGap: 18,
        rowGap: 8,
        marginTop: 8,
        lineHeight: 1.65,
      }}
    >
      {normalizedRows.map(option => (
        <div
          key={option.label}
          style={{
            display: 'grid',
            gridTemplateColumns: '24px minmax(0, 1fr)',
            minWidth: 0,
          }}
        >
          <span style={{ fontWeight: 400 }}>{option.label}.</span>
          <QuestionRichText terms={terms}>{option.content}</QuestionRichText>
        </div>
      ))}
    </div>
  );
};

export default QuestionOptionsView;
