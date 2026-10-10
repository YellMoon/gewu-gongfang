import React, { useEffect, useState } from 'react';
import { Button, InputNumber, Space, Typography } from 'antd';
const { difficultyLabel, validDifficultyCoefficient } = require('../../shared/questionDifficulty');
const QuestionDifficultyField: React.FC<{
  value?: number | null;
  disabled?: boolean;
  onSave: (value: number | null) => void;
  batch?: boolean;
}> = ({ value, disabled, onSave, batch = false }) => {
  const [draft, setDraft] = useState<number | null>(value ?? null);
  useEffect(() => setDraft(value ?? null), [value]);
  return <Space wrap className="qb-difficulty-field">
    <span>{'\u96BE\u5EA6\u7CFB\u6570\uFF1A'}</span>
    <InputNumber aria-label={batch ? '\u6279\u91CF\u96BE\u5EA6\u7CFB\u6570' : '\u96BE\u5EA6\u7CFB\u6570'}
      value={draft} min={0} max={1} step={0.01} disabled={disabled}
      onChange={setDraft} onPressEnter={() => { if (validDifficultyCoefficient(draft)) onSave(draft); }} style={{ width: 130 }}
      placeholder="0 ~ 1" />
    <Typography.Text type="secondary">{difficultyLabel(draft)}</Typography.Text>
    <Button disabled={disabled || !validDifficultyCoefficient(draft)} onClick={() => onSave(draft)}>{batch ? '\u5E94\u7528\u96BE\u5EA6\u5230\u6240\u9009\u8BD5\u9898' : '\u4FDD\u5B58\u96BE\u5EA6'}</Button>
  </Space>;
};
export default QuestionDifficultyField;
