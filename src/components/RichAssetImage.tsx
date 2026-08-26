import React, { useEffect, useMemo, useState } from 'react';
import { getQuestionAssetDataUrl } from '../services/questionAssetStore';
import {
  assetDisplayRef,
  replacePersistedAssetImageSources,
  resolveAssetForDisplay,
  splitPersistedAssetImages,
} from './richQuestionEditorState';

type RichAssetImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string;
  assetKey?: string;
};

export const RichAssetImage: React.FC<RichAssetImageProps> = ({ src, assetKey, alt = '', ...imageProps }) => {
  const source = assetDisplayRef(src, assetKey);
  const persisted = source.startsWith('question-asset://');
  const [resolution, setResolution] = useState<{ source: string; displaySrc: string; failed: boolean }>({
    source: '',
    displaySrc: '',
    failed: false,
  });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!persisted) return undefined;
    let alive = true;
    resolveAssetForDisplay(source, getQuestionAssetDataUrl)
      .then(displaySrc => {
        if (alive) setResolution({ source, displaySrc, failed: false });
      })
      .catch(() => {
        if (!alive) return;
        const pending = retry < 5;
        setResolution({ source, displaySrc: '', failed: !pending });
        if (pending) window.setTimeout(() => { if (alive) setRetry(value => value + 1); }, 1000);
      });
    return () => { alive = false; };
  }, [persisted, source, retry]);

  if (!persisted) return source ? <img {...imageProps} src={source} alt={alt} /> : null;
  if (resolution.source === source && resolution.displaySrc) {
    return <img {...imageProps} src={resolution.displaySrc} alt={alt} />;
  }
  return <span role="status">{resolution.source === source && resolution.failed ? '\u56fe\u7247\u52a0\u8f7d\u5931\u8d25' : '\u56fe\u7247\u52a0\u8f7d\u4e2d'}</span>;
};

type ResolvedRichHtmlProps = {
  html: string;
  as?: 'span' | 'div';
  className?: string;
};

export const ResolvedRichHtml: React.FC<ResolvedRichHtmlProps> = ({ html, as = 'span', className }) => {
  const refs = useMemo(() => Array.from(new Set(
    splitPersistedAssetImages(html)
      .filter((part): part is Extract<ReturnType<typeof splitPersistedAssetImages>[number], { kind: 'asset' }> => part.kind === 'asset')
      .map(part => part.src),
  )), [html]);
  const [resolution, setResolution] = useState<{ source: string; html: string }>({ source: '', html: '' });

  useEffect(() => {
    if (refs.length === 0) return undefined;
    let alive = true;
    Promise.all(refs.map(async ref => {
      try {
        return [ref, await resolveAssetForDisplay(ref, getQuestionAssetDataUrl)] as const;
      } catch (_error) {
        return [ref, ''] as const;
      }
    })).then(entries => {
      if (alive) setResolution({ source: html, html: replacePersistedAssetImageSources(html, new Map(entries)) });
    });
    return () => { alive = false; };
  }, [html, refs]);

  const Tag = as;
  if (refs.length > 0 && resolution.source !== html) {
    return <Tag className={className}><span role="status">\u56fe\u7247\u52a0\u8f7d\u4e2d</span></Tag>;
  }
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: refs.length > 0 ? resolution.html : html }} />;
};
