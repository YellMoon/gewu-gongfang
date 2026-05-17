import React from 'react';
import { Space, Tag, Typography } from 'antd';
import QuestionRichText from './QuestionRichText';

const { Text } = Typography;

function decodeDataUrlJson(value?: string): any | null {
  if (!value || !value.startsWith('data:application/json;base64,')) return null;
  try {
    const encoded = value.slice('data:application/json;base64,'.length);
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch (_err) {
    return null;
  }
}

function formulaText(formula: any): string {
  if (!formula) return '';
  if (typeof formula === 'string') return formula;
  return formula.text || formula.field_code || formula.latex || formula.mathml || '';
}

function formulaFromAsset(asset: any): any {
  return decodeDataUrlJson(asset?.oss_url || asset?.data_url || asset?.url) || {
    format: asset?.asset_type,
    text: asset?.file_name || asset?.prog_id || '公式对象',
  };
}

const QuestionRichContent: React.FC<{ question: any; terms?: string[] }> = ({ question, terms = [] }) => {
  const assets = Array.isArray(question?.assets) ? question.assets : [];
  const imageAssets = assets.filter((asset: any) => asset.asset_type === 'image');
  const formulaAssets = assets.filter((asset: any) => String(asset.asset_type || '').startsWith('formula_'));
  const formulas = [
    ...(Array.isArray(question?.formulas) ? question.formulas : []),
    ...formulaAssets.filter((asset: any) => asset.asset_type !== 'formula_preview').map(formulaFromAsset),
  ]
    .map(formula => ({ raw: formula, text: formulaText(formula) }))
    .filter(item => item.text && !/^[a-zA-Z0-9_]+omml$/.test(item.text));

  if (imageAssets.length === 0 && formulas.length === 0) return null;

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
      {formulas.length > 0 && (
        <Space direction="vertical" size={4}>
          {formulas.map((item: any, index: number) => (
            <Text key={index} code style={{ whiteSpace: 'pre-wrap' }}>
              <QuestionRichText terms={terms}>{item.text}</QuestionRichText>
              {item.raw?.format && item.raw.format !== 'omml' && <Tag color="purple" style={{ marginLeft: 8 }}>{item.raw.format}</Tag>}
            </Text>
          ))}
          {formulaAssets.filter((asset: any) => asset.asset_type === 'formula_preview').map((asset: any, index: number) => {
            const src = asset.oss_url || asset.data_url || asset.url;
            return src ? (
              <img
                key={asset.content_hash || asset.id || `formula-preview-${index}`}
                src={src}
                alt={asset.file_name || `formula-preview-${index + 1}`}
                style={{ maxWidth: 240, maxHeight: 120, objectFit: 'contain', border: '1px solid #f1e8ff', borderRadius: 4 }}
              />
            ) : null;
          })}
        </Space>
      )}
    </Space>
  );
};

export default QuestionRichContent;
