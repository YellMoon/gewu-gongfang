import type { JSONContent } from '@tiptap/react';
import type { QuestionRichDocument } from '../../types/questionRichContent';

export function cleanHiddenQuestionImages(value: QuestionRichDocument, assets: Array<Record<string, any>> = []) {
  const removed: Array<{ section: string; assetKey: string; width: number; height: number; reason: string }> = [];
  const previews = new Set<string>();
  const docs: Array<[string, JSONContent]> = [ ['题干', value.sections.stem], ['答案', value.sections.answer], ['解析', value.sections.analysis],
    ...value.sections.options.map(option => [`选项 ${option.label}`, option.content] as [string, JSONContent]),
    ...value.sections.subQuestions.flatMap(sub => [[`小题 ${sub.label}`, sub.content], [`小题答案 ${sub.label}`, sub.answer]] as Array<[string, JSONContent]>),
  ];
  const protectPreviews = (node: JSONContent) => {
    if (node.type === 'formula' || node.type === 'formulaBlock') {
      if (node.attrs?.previewRef) {
        const ref = String(node.attrs.previewRef).replace(/^question-asset:\/\//, '');
        previews.add(ref);
        previews.add(ref.split('/').pop()!);
      }
    }
    node.content?.forEach(protectPreviews);
  };
  docs.forEach(([, doc]) => protectPreviews(doc));
  assets.forEach(asset => {
    if (String(asset.asset_type || '').startsWith('formula_') || previews.has(asset.source_part) || previews.has(asset.file_name)) {
      for (const key of [asset.content_hash, asset.assetKey, asset.asset_key, asset.id, asset.file_name]) if (key) previews.add(String(key));
    }
  });
  const cleanNode = (node: JSONContent, section: string): JSONContent | null => {
    if (node.type === 'image') {
      const { width, height, alt, title, assetKey, src } = node.attrs || {};
      const metadata = `${alt || ''} ${title || ''}`;
      const protectedImage = previews.has(String(assetKey || src?.replace(/^question-asset:\/\//, '')))
        || previews.has(String(alt || ''))
        || /mathtype|equation|formula|公式|\.wmf\b|\.emf\b/i.test(metadata);
      const sized = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
      const collapsed = sized && Math.max(width, height) <= 3;
      const branding = /logo|watermark|网站(?:标识|标志)|水印|组卷网|学科网|zxxk|zujuan|www\.[a-z0-9.-]+|[a-z0-9-]+\.(?:com|cn|net)\b/i.test(metadata);
      const tinyBrand = sized && branding && Math.max(width, height) <= 24 && Math.min(width, height) <= 12;
      if (!protectedImage && (collapsed || tinyBrand)) {
        removed.push({ section, assetKey: String(assetKey || ''), width, height, reason: collapsed ? '不可辨识微缩图片' : '微小网站标识' });
        return null;
      }
    }
    if (!node.content) return node;
    const content = node.content.map(child => cleanNode(child, section)).filter((child): child is JSONContent => child !== null);
    if (!content.length && ['tableCell', 'tableHeader', 'listItem', 'blockquote'].includes(node.type || '')) content.push({ type: 'paragraph' });
    return { ...node, content };
  };
  const cleanDoc = (doc: JSONContent, section: string) => cleanNode(doc, section)!;
  return { value: { ...value, sections: {
    stem: cleanDoc(value.sections.stem, '题干'), answer: cleanDoc(value.sections.answer, '答案'), analysis: cleanDoc(value.sections.analysis, '解析'),
    options: value.sections.options.map(option => ({ ...option, content: cleanDoc(option.content, `选项 ${option.label}`) })),
    subQuestions: value.sections.subQuestions.map(sub => ({ ...sub, content: cleanDoc(sub.content, `小题 ${sub.label}`), answer: cleanDoc(sub.answer, `小题答案 ${sub.label}`) })),
  } }, removed };
}
