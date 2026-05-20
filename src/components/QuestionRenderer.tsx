import React, { useMemo, useState, useCallback } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './QuestionRenderer.css';
import {
  applyPhysicsNotationToHTML,
  createKaTeXPhysicsOptions,
  formatChoiceOptions,
  restoreSuperscriptsAndSubscripts,
  PHYSICS_KATEX_GLOBAL_MACROS,
  PHYSICS_KATEX_MACROS,
} from '../utils/physicsNotation';

interface QuestionRendererProps {
  content: string;
  options?: string[];
  questionType?: string;
  /** 表格单元格内联模式：截断纯文本 */
  inline?: boolean;
  /** 答案（抽屉展开后显示） */
  answer?: string;
  /** 解析（抽屉展开后显示） */
  analysis?: string;
}

interface ContentSegment {
  type: 'html' | 'math-display' | 'math-inline';
  value: string;
}

function splitInlineMath(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const re = /\$([^$]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'html', value: text.slice(last, m.index) });
    }
    segments.push({ type: 'math-inline', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ type: 'html', value: text.slice(last) });
  }
  return segments;
}

function splitMixedContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const re = /\$\$([\s\S]*?)\$\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      segments.push(...splitInlineMath(content.slice(last, m.index)));
    }
    segments.push({ type: 'math-display', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push(...splitInlineMath(content.slice(last)));
  }
  return segments.length > 0 ? segments : [{ type: 'html', value: content }];
}

export function stripHtmlAndMath(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$]+?\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 对非数学模式的 HTML 文本应用物理学科字体规范和丢失格式恢复 */
function processHtmlSegment(html: string): string {
  if (/<[a-zA-Z][^>]*>/.test(html)) return html;
  // 先恢复丢失的上/下角标，再应用物理正斜体规范
  const restored = restoreSuperscriptsAndSubscripts(html);
  return applyPhysicsNotationToHTML(restored);
}

const KaTeXMath: React.FC<{ latex: string; displayMode: boolean }> = ({ latex, displayMode }) => {
  let rendered: string;
  try {
    rendered = katex.renderToString(latex, createKaTeXPhysicsOptions(displayMode));
  } catch {
    rendered = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      macros: {},
    });
  }
  if (displayMode) {
    return <div className="math-display" dangerouslySetInnerHTML={{ __html: rendered }} />;
  }
  return <span className="math-inline" dangerouslySetInnerHTML={{ __html: rendered }} />;
};

const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  content,
  options,
  questionType,
  inline,
  answer,
  analysis,
}) => {
  const hasDrawer = !!(answer || analysis);
  const [expanded, setExpanded] = useState(false);

  const segments = useMemo(
    () => splitMixedContent(content || ''),
    [content],
  );

  // 格式化选项（标签正体+全角点号，内容应用物理规范）
  const formattedOptions = useMemo(
    () => (options && options.length > 0 ? formatChoiceOptions(options) : options),
    [options],
  );

  const handleStemClick = useCallback(() => {
    if (hasDrawer && !expanded) setExpanded(true);
  }, [hasDrawer, expanded]);

  const handleDrawerClick = useCallback(() => {
    if (expanded) setExpanded(false);
  }, [expanded]);

  if (inline) {
    const plain = stripHtmlAndMath(content || '');
    return (
      <span
        style={{
          maxWidth: 350,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        }}
      >
        {plain}
      </span>
    );
  }

  const renderSegment = (seg: ContentSegment, idx: number) => {
    if (seg.type === 'math-display') {
      return <KaTeXMath key={idx} latex={seg.value} displayMode />;
    }
    if (seg.type === 'math-inline') {
      return <KaTeXMath key={idx} latex={seg.value} displayMode={false} />;
    }
    if (!seg.value.trim()) return null;
    const processed = processHtmlSegment(seg.value);
    return <span key={idx} dangerouslySetInnerHTML={{ __html: processed }} />;
  };

  // 图片嵌入在题干 HTML 中保持真实位置，不再单独提取
  const optCount = formattedOptions?.length || 0;
  const optCols = optCount === 4 ? 4 : optCount === 3 ? 3 : 2;

  return (
    <div className="question-content">
      {/* 题干区 */}
      <div
        className={`question-stem-wrapper${hasDrawer ? ' has-drawer' : ''}${expanded ? ' expanded' : ''}`}
        onClick={handleStemClick}
      >
        <div className="question-stem">{segments.map(renderSegment)}</div>

        {formattedOptions && optCount > 0 && (
          <div className={`question-options cols-${optCols}`}>
            {formattedOptions.map((opt, i) => (
              <div key={i} className="question-option" dangerouslySetInnerHTML={{ __html: opt }} />
            ))}
          </div>
        )}

        {hasDrawer && !expanded && (
          <div className="drawer-hint">
            <span className="drawer-hint-icon">&#9660;</span>
          </div>
        )}
      </div>

      {/* 答案与解析抽屉 */}
      {hasDrawer && (
        <div
          className={`question-drawer${expanded ? ' open' : ''}`}
          onClick={handleDrawerClick}
        >
          <div className="question-drawer-inner">
            {answer && (
              <div className="question-answer">
                <strong>答案：</strong>
                <span dangerouslySetInnerHTML={{ __html: answer }} />
              </div>
            )}
            {analysis && (
              <div className="question-analysis">
                <strong>【解析】</strong>
                <span dangerouslySetInnerHTML={{ __html: analysis }} />
              </div>
            )}
            <div className="drawer-hint collapse-hint">
              <span className="drawer-hint-icon">&#9650;</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuestionRenderer;
export { createKaTeXPhysicsOptions, PHYSICS_KATEX_GLOBAL_MACROS, PHYSICS_KATEX_MACROS };
