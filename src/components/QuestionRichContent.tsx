import React from 'react';
import { Space, Tag, Typography } from 'antd';

const { Text } = Typography;

function formulaText(formula: any): string {
  if (!formula) return '';
  if (typeof formula === 'string') return formula;
  return formula.text || formula.field_code || formula.format || '公式';
}

const QuestionRichContent: React.FC<{ question: any }> = ({ question }) => {
  const assets = Array.isArray(question?.assets) ? question.assets : [];
  const imageAssets = assets.filter((asset: any) => asset.asset_type === 'image');
  const formulaAssets = assets.filter((asset: any) => String(asset.asset_type || '').startsWith('formula_'));
  const formulas = Array.isArray(question?.formulas) ? question.formulas : [];

  if (imageAssets.length === 0 && formulaAssets.length === 0 && formulas.length === 0) return null;

  return (
    <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
      {imageAssets.length > 0 && (
        <Space wrap>
          {imageAssets.map((asset: any, index: number) => {
            const src = asset.oss_url || asset.data_url || asset.url;
            return src ? (
              <img
                key={asset.content_hash || asset.id || index}
                src={src}
                alt={asset.file_name || `question-image-${index + 1}`}
                style={{ maxWidth: 360, maxHeight: 220, objectFit: 'contain', border: '1px solid #edf0f5', borderRadius: 4 }}
              />
            ) : (
              <Tag key={asset.content_hash || index} color="cyan">{asset.file_name || '图片'}</Tag>
            );
          })}
        </Space>
      )}
      {(formulas.length > 0 || formulaAssets.length > 0) && (
        <Space direction="vertical" size={4}>
          {formulas.map((formula: any, index: number) => (
            <Text key={index} code>{formulaText(formula)}</Text>
          ))}
          {formulaAssets.map((asset: any, index: number) => (
            <Tag key={asset.content_hash || index} color="purple">{asset.asset_type}: {asset.file_name || '公式对象'}</Tag>
          ))}
        </Space>
      )}
    </Space>
  );
};

export default QuestionRichContent;
