import React from 'react';
import QuestionRichText from './QuestionRichText';

function normalizeOption(option: any, index: number): { label: string; content: string } {
  if (typeof option === 'string') {
    const match = option.trim().match(/^([A-Z])[\.\u3001\uff0e\s]+([\s\S]*)$/i);
    return {
      label: (match?.[1] || String.fromCharCode(65 + index)).toUpperCase(),
      content: (match?.[2] || option).trim(),
    };
  }
  return {
    label: String(option?.label || String.fromCharCode(65 + index)).toUpperCase(),
    content: String(option?.content || option?.text || '').trim(),
  };
}

function columnsForOptions(options: Array<{ label: string; content: string }>): number {
  if (options.length >= 5) return 1;
  if (options.length !== 4) return 1;
  const maxLen = Math.max(...options.map(option => option.content.replace(/<[^>]+>/g, '').length));
  if (maxLen <= 12) return 4;
  if (maxLen <= 28) return 2;
  return 1;
}

const QuestionOptionsView: React.FC<{
  options?: any[];
  terms?: string[];
}> = ({ options = [], terms = [] }) => {
  const rows = (Array.isArray(options) ? options : [])
    .map(normalizeOption)
    .filter(option => option.content);
  if (rows.length === 0) return null;

  const columns = columnsForOptions(rows);
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
      {rows.map(option => (
        <div
          key={option.label}
          style={{
            display: 'grid',
            gridTemplateColumns: '24px minmax(0, 1fr)',
            minWidth: 0,
          }}
        >
          <span style={{ fontWeight: 600 }}>{option.label}.</span>
          <QuestionRichText terms={terms}>{option.content}</QuestionRichText>
        </div>
      ))}
    </div>
  );
};

export default QuestionOptionsView;
