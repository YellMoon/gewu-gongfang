import { getQuestionAssetDataUrl, storeQuestionAsset } from './questionAssetStore';

export async function collectEditedIntakeMedia(parsed: any, questions: any[]): Promise<any> {
  const mediaBytes: Uint8Array[][] = [];
  const candidates = [];
  for (const [itemIndex, inputQuestion] of questions.entries()) {
    const question = JSON.parse(JSON.stringify(inputQuestion));
    const original = parsed.candidates[itemIndex];
    const referenced = new Set<string>();
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'image' && node.attrs?.assetKey) referenced.add(node.attrs.assetKey);
      if (['formula', 'formulaBlock'].includes(node.type) && node.attrs?.previewRef) {
        const preview = String(node.attrs.previewRef);
        const convertedName = preview.split('/').pop()?.replace(/\.(?:emf|wmf)$/i, '.png');
        const source = (original.candidate.assets || []).find((asset: any) => preview === `question-asset://${asset.contentHash}`
          || preview === asset.fileName || preview.endsWith('/' + asset.fileName)
          || (asset.mimeType === 'image/png' && convertedName !== preview.split('/').pop() && asset.fileName === convertedName));
        if (source) {
          referenced.add(source.contentHash);
          node.attrs.previewRef = `question-asset://${source.contentHash}`;
        }
        else if (preview.startsWith('question-asset://')) referenced.add(preview.slice('question-asset://'.length));
        else if (node.attrs.conversionStatus === 'complete' && typeof node.attrs.canonicalLatex === 'string' && node.attrs.canonicalLatex.trim()) delete node.attrs.previewRef;
        else throw new Error('QUESTION_INTAKE_FORMULA_PREVIEW_UNAVAILABLE');
      }
      Object.values(node).forEach(value => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      });
    };
    if (question.rich_content?.type === 'question-document') visit(question.rich_content);
    else (original.candidate.assets || []).forEach((asset: any) => referenced.add(asset.contentHash));
    const assets: Array<{ assetIndex: number; assetType: string; fileName: string; mimeType: string; sizeBytes: number; contentHash: string }> = [];
    const mediaManifest = [], bytesForItem = [];
    for (const key of referenced) {
      const dataUrl = await getQuestionAssetDataUrl(key);
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
      if (!match) throw new Error('QUESTION_INTAKE_MEDIA_UNAVAILABLE');
      const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== key && `image-${digest}` !== key) throw new Error('QUESTION_INTAKE_MEDIA_HASH_MISMATCH');
      if (digest !== key) {
        await storeQuestionAsset(digest, dataUrl);
        const rewrite = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (node.type === 'image' && node.attrs?.assetKey === key) {
            node.attrs.assetKey = digest;
            node.attrs.src = `question-asset://${digest}`;
            if (node.attrs.persistedSrc) node.attrs.persistedSrc = `question-asset://${digest}`;
          }
          Object.values(node).forEach(value => {
            if (Array.isArray(value)) value.forEach(rewrite);
            else if (value && typeof value === 'object') rewrite(value);
          });
        };
        rewrite(question.rich_content);
        const rewriteProjectedReferences = (value: any): any => {
          if (typeof value === 'string') return value.split(`question-asset://${key}`).join(`question-asset://${digest}`);
          if (Array.isArray(value)) return value.map(rewriteProjectedReferences);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, rewriteProjectedReferences(child)]));
          return value;
        };
        for (const field of ['stem', 'content', 'options', 'sub_questions', 'answer', 'analysis', 'explanation']) {
          if (question[field] != null) question[field] = rewriteProjectedReferences(question[field]);
        }
      }
      if (assets.some(asset => asset.contentHash === digest)) continue;
      const sourceAsset = (original.candidate.assets || []).find((asset: any) => asset.contentHash === key)
        || (question.assets || []).find((asset: any) => asset.content_hash === key);
      const mimeType = match[1];
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' } as Record<string, string>)[mimeType]
        || (/^image\/[A-Za-z0-9.+-]{1,64}$/.test(mimeType) ? mimeType.slice('image/'.length).replace(/\+/g, '-') : undefined);
      if (!extension) throw new Error('QUESTION_INTAKE_MEDIA_TYPE_INVALID');
      assets.push({ assetIndex: assets.length, assetType: sourceAsset?.assetType || sourceAsset?.asset_type || 'image', fileName: sourceAsset?.fileName || sourceAsset?.file_name || `${digest}.${extension}`,
        mimeType, sizeBytes: bytes.byteLength, contentHash: digest });
      mediaManifest.push({ sha256: digest, bytes: bytes.byteLength, mimeType });
      bytesForItem.push(bytes);
    }
    candidates.push({ ...original, candidate: { ...question, assets }, mediaManifest });
    mediaBytes.push(bytesForItem);
  }
  return { ...parsed, candidates, mediaBytes };
}

// A derived display cache; cloud submission receives descriptors, never these data URLs.
export async function prepareLocalIntakePreview(parsed: any): Promise<any[]> {
  const questions = [];
  for (const [itemIndex, item] of parsed.candidates.entries()) {
    const assets = [];
    for (const asset of item.candidate.assets || []) {
      const bytes = parsed.mediaBytes[itemIndex][asset.assetIndex];
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: asset.mimeType }));
      });
      const ref = await storeQuestionAsset(asset.contentHash, dataUrl);
      assets.push({ ...asset, content_hash: asset.contentHash, file_name: asset.fileName, asset_type: asset.assetType,
        mime_type: asset.mimeType, size_bytes: asset.sizeBytes, data_url: ref });
    }
    questions.push({ ...item.candidate, assets });
  }
  return questions;
}
