// encoding: utf-8
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ColorPicker, Input, Modal, Select, Space, Tooltip, Upload, message } from 'antd';
import { AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, DeleteOutlined, FileImageOutlined, FontColorsOutlined, FunctionOutlined, ItalicOutlined, OrderedListOutlined, RedoOutlined, StrikethroughOutlined, UnderlineOutlined, UndoOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import type { JSONContent, NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import katex from 'katex';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { storeQuestionAsset } from '../services/questionAssetStore';
import { appendSequentialTask, clampSelection, decideExternalSync, enqueueEmission, mapPendingBookmarks, maskPersistedImagesForEditor, requireStoredAssetRef, restorePersistedImagesFromEditor } from './richQuestionEditorState';
import { RichAssetImage } from './RichAssetImage';

export interface RichQuestionEditorProps { value?: string | JSONContent; onChange?: (value: string | JSONContent) => void; onHtmlChange?: (html: string) => void; output?: 'html' | 'json'; placeholder?: string; minHeight?: number; onStoreImage?: (assetKey: string, dataUrl: string, file: File) => Promise<string>; disabled?: boolean; }
const t = (value: string) => value;
const FONTS = [{ value: '', label: t('\u9ed8\u8ba4\u5b57\u4f53') }, { value: 'SimSun', label: t('\u5b8b\u4f53') }, { value: 'Microsoft YaHei', label: t('\u5fae\u8f6f\u96c5\u9ed1') }, { value: 'KaiTi', label: t('\u6977\u4f53') }, { value: 'FangSong', label: t('\u4eff\u5b8b') }, { value: 'Arial', label: 'Arial' }, { value: 'Times New Roman', label: 'Times New Roman' }];
const SIZES = ['12', '14', '16', '18', '20', '24', '28', '32'].map(value => ({ value, label: `${value}px` }));
const LINE_HEIGHTS = ['1', '1.25', '1.5', '1.75', '2'].map(value => ({ value, label: value }));
const RichImageView: React.FC<NodeViewProps> = ({ node, selected }) => {
  return <NodeViewWrapper as="figure" className={`rich-image-node${selected ? ' is-selected' : ''}`} data-align={node.attrs.align} contentEditable={false}><RichAssetImage src={node.attrs.persistedSrc || node.attrs.src} assetKey={node.attrs.assetKey} alt={node.attrs.alt || ''} width={node.attrs.width || undefined} /></NodeViewWrapper>;
};
const RichTextStyle = TextStyle.extend({ addAttributes() { return { ...this.parent?.(), fontSize: { default: null, parseHTML: element => element.style.fontSize || null, renderHTML: attrs => attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {} } }; } });
const RichImage = Image.extend({ addAttributes() { return { ...this.parent?.(), assetKey: { default: undefined, parseHTML: element => element.getAttribute('data-asset-key') || undefined, renderHTML: attrs => attrs.assetKey ? { 'data-asset-key': attrs.assetKey } : {} }, persistedSrc: { default: undefined, parseHTML: element => element.getAttribute('data-persisted-src') || undefined, renderHTML: attrs => attrs.persistedSrc ? { 'data-persisted-src': attrs.persistedSrc } : {} }, width: { default: undefined, parseHTML: element => { const value = element.getAttribute('width'); return value ? Number(value) : undefined; }, renderHTML: attrs => attrs.width ? { width: attrs.width } : {} }, align: { default: 'center', parseHTML: element => element.getAttribute('data-align') || 'center', renderHTML: attrs => ({ 'data-align': attrs.align }) } }; }, addNodeView() { return ReactNodeViewRenderer(RichImageView); } });
const ParagraphTypography = Extension.create({
  name: 'paragraphTypography',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: { lineHeight: { default: null, parseHTML: element => element.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height:${attrs.lineHeight}` } : {} }, indent: { default: 0, parseHTML: element => Number(element.getAttribute('data-indent') || 0), renderHTML: attrs => attrs.indent ? { 'data-indent': attrs.indent, style: `margin-left:${attrs.indent * 2}em` } : {} } } }]; },
});

const FormulaView: React.FC<NodeViewProps> = ({ node, selected, updateAttributes, editor }) => {
  const latex = String(node.attrs.canonicalLatex || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const html = katex.renderToString(latex, { throwOnError: false, displayMode: node.attrs.displayMode === 'block' });
  return <NodeViewWrapper as={node.type.name === 'formulaBlock' ? 'div' : 'span'} className={`rich-formula-node${selected ? ' is-selected' : ''}`} data-latex={latex} onDoubleClick={() => { if (editor.isEditable) { setDraft(latex); setEditing(true); } }}>
    <span dangerouslySetInnerHTML={{ __html: html }} />
    <Modal open={editing} title={t('\u7f16\u8f91 LaTeX \u516c\u5f0f')} onCancel={() => setEditing(false)} onOk={() => { const canonicalLatex = draft.trim().replace(/^\$+|\$+$/g, ''); if (editor.isEditable && canonicalLatex) updateAttributes({ canonicalLatex }); setEditing(false); }} okButtonProps={{ disabled: !editor.isEditable }} okText={t('\u66f4\u65b0\u516c\u5f0f')} cancelText={t('\u53d6\u6d88')}>
      <Input.TextArea disabled={!editor.isEditable} aria-label={t('LaTeX \u516c\u5f0f')} rows={3} value={draft} onChange={event => setDraft(event.target.value)} />
      <div className="rich-question-editor__formula-preview" role="status" aria-live="polite"><span dangerouslySetInnerHTML={{ __html: katex.renderToString(draft.trim() || '\\square', { throwOnError: false, displayMode: node.attrs.displayMode === 'block' }) }} /></div>
    </Modal>
  </NodeViewWrapper>;
};
const Formula = Node.create({
  name: 'formula', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { const data = (key: string, name = key) => ({ default: undefined, parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) || undefined, renderHTML: (attrs: any) => attrs[key] != null ? { [`data-${name}`]: attrs[key] } : {} }); return { id: data('id'), canonicalLatex: data('canonicalLatex', 'latex'), displayMode: data('displayMode', 'display-mode'), sourceRef: data('sourceRef', 'source-ref'), warnings: { default: undefined, parseHTML: element => { try { return JSON.parse(element.getAttribute('data-warnings') || 'null') || undefined; } catch { return undefined; } }, renderHTML: attrs => attrs.warnings ? { 'data-warnings': JSON.stringify(attrs.warnings) } : {} }, conversionStatus: data('conversionStatus', 'conversion-status'), sourceFormat: data('sourceFormat', 'source-format'), previewRef: data('previewRef', 'preview-ref') }; },
  parseHTML() { return [{ tag: 'span[data-formula]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-formula': 'latex' })]; },
  addNodeView() { return ReactNodeViewRenderer(FormulaView); },
});
const FormulaBlock = Formula.extend({ name: 'formulaBlock', group: 'block', inline: false, parseHTML() { return [{ tag: 'div[data-formula-block]' }]; }, renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-formula-block': 'latex' })]; } });

const RichQuestionEditor: React.FC<RichQuestionEditorProps> = ({ value = '', onChange, onHtmlChange, output = 'html', placeholder, minHeight = 160, onStoreImage = storeQuestionAsset, disabled = false }) => {
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaText, setFormulaText] = useState('');
  const [blockFormula, setBlockFormula] = useState(false);
  const [imageAlt, setImageAlt] = useState('');
  const [, forceSelectionRender] = useState(0);
  const pendingEmissions = useRef<string[]>([]);
  const mounted = useRef(true);
  const imageInsertQueue = useRef<Promise<void>>(Promise.resolve());
  const imageSequence = useRef(0);
  const pendingImagePositions = useRef(new Map<number, { from: number; to: number }>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editor = useEditor({
    extensions: [StarterKit, RichTextStyle, ParagraphTypography, Color, FontFamily, Underline, Highlight.configure({ multicolor: true }), Subscript, Superscript, TextAlign.configure({ types: ['heading', 'paragraph'] }), RichImage.configure({ allowBase64: false }), Formula, FormulaBlock],
    content: maskPersistedImagesForEditor(value || ''),
    editorProps: {
      attributes: { class: 'rich-question-editor__surface', 'data-placeholder': placeholder || '', 'aria-label': placeholder || t('\u9898\u76ee\u5bcc\u6587\u672c\u7f16\u8f91\u533a') },
      transformPastedHTML: html => sanitizeHtml(html),
    },
    onCreate: ({ editor: current }) => { if (output === 'json') { onChange?.(restorePersistedImagesFromEditor(current.getJSON())); onHtmlChange?.(restorePersistedImagesFromEditor(current.getHTML())); } },
    onUpdate: ({ editor: current }) => { const next = restorePersistedImagesFromEditor(output === 'json' ? current.getJSON() : current.getHTML()); pendingEmissions.current = enqueueEmission(pendingEmissions.current, next); onChange?.(next); onHtmlChange?.(restorePersistedImagesFromEditor(current.getHTML())); },
    onSelectionUpdate: ({ editor: current }) => { setImageAlt(current.isActive('image') ? String(current.getAttributes('image').alt || '') : ''); forceSelectionRender(value => value + 1); },
    onTransaction: ({ transaction }) => { pendingImagePositions.current = mapPendingBookmarks(pendingImagePositions.current, (position, assoc) => transaction.mapping.map(position, assoc)); },
  });
  useEffect(() => {
    if (!editor) return;
    const currentValue = restorePersistedImagesFromEditor(output === 'json' ? editor.getJSON() : editor.getHTML());
    const current = output === 'json' ? JSON.stringify(currentValue) : String(currentValue);
    const incoming = output === 'json' ? JSON.stringify(value || { type: 'doc', content: [] }) : String(value || '');
    const decision = decideExternalSync(incoming, current, pendingEmissions.current);
    pendingEmissions.current = decision.pendingEmissions;
    if (decision.apply) {
      const selection = { from: editor.state.selection.from, to: editor.state.selection.to };
      editor.commands.setContent(maskPersistedImagesForEditor(value || ''), false);
      editor.commands.setTextSelection(clampSelection(selection, editor.state.doc.content.size + 2));
    }
  }, [editor, output, value]);
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  const insertImage = useCallback((file: File) => {
    const bookmark = editor ? { from: editor.state.selection.from, to: editor.state.selection.to } : null;
    const sequence = ++imageSequence.current;
    if (bookmark) pendingImagePositions.current.set(sequence, bookmark);
    const reader = new FileReader();
    const persisted = new Promise<{ src: string; assetKey: string }>((resolve, reject) => {
      reader.onerror = () => reject(reader.error || new Error(t('\u56fe\u7247\u8bfb\u53d6\u5931\u8d25')));
      reader.onload = async () => { try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        const assetKey = `image-${digest}`;
        const src = await onStoreImage(assetKey, String(reader.result || ''), file);
        requireStoredAssetRef(assetKey, src);
        resolve({ src, assetKey });
      } catch (error) { reject(error); } };
    });
    reader.readAsDataURL(file);
    imageInsertQueue.current = appendSequentialTask(imageInsertQueue.current, async () => {
      try {
        const attrs = await persisted;
        if (!mounted.current || !editor || !bookmark) return;
        const mapped = pendingImagePositions.current.get(sequence) || bookmark;
        const range = { from: Math.min(mapped.from, editor.state.doc.content.size), to: Math.min(Math.max(mapped.from, mapped.to), editor.state.doc.content.size) };
        editor.chain().focus().insertContentAt(range, maskPersistedImagesForEditor({ type: 'image', attrs: { ...attrs, alt: file.name } })).run();
        pendingImagePositions.current.delete(sequence);
      } catch (error) { pendingImagePositions.current.delete(sequence); if (mounted.current) message.error(error instanceof Error ? error.message : t('\u56fe\u7247\u5b58\u50a8\u5931\u8d25')); }
    });
    return false;
  }, [editor, onStoreImage]);
  if (!editor) return null;
  const insertFormula = () => { const latex = formulaText.trim().replace(/^\$+|\$+$/g, ''); if (!latex) return; editor.chain().focus().insertContent({ type: blockFormula ? 'formulaBlock' : 'formula', attrs: { id: `formula-${Date.now()}`, canonicalLatex: latex, displayMode: blockFormula ? 'block' : 'inline', sourceFormat: 'latex' } }).run(); setFormulaText(''); setFormulaOpen(false); };
  const tool = (title: string, icon: React.ReactNode, pressed: boolean | undefined, run: () => void, disabled = false) => <Tooltip title={title}><Button aria-label={title} aria-pressed={pressed} size="small" type={pressed ? 'primary' : 'default'} icon={icon} disabled={disabled} onClick={run} /></Tooltip>;
  return <div className="rich-question-editor" aria-disabled={disabled}>
    {!disabled && <div className="rich-question-editor__toolbar" role="toolbar" aria-label={t('\u5bcc\u6587\u672c\u683c\u5f0f\u5de5\u5177\u680f')}><Space size={4} wrap>
      {tool(t('\u64a4\u9500'), <UndoOutlined />, undefined, () => editor.chain().focus().undo().run(), !editor.can().undo())}{tool(t('\u91cd\u505a'), <RedoOutlined />, undefined, () => editor.chain().focus().redo().run(), !editor.can().redo())}<span className="rich-question-editor__divider" />
      <Select aria-label={t('\u5b57\u4f53')} size="small" value={editor.getAttributes('textStyle').fontFamily || ''} options={FONTS} style={{ width: 132 }} onChange={font => font ? editor.chain().focus().setFontFamily(font).run() : editor.chain().focus().unsetFontFamily().run()} />
      <Select aria-label={t('\u5b57\u53f7')} size="small" value={String(editor.getAttributes('textStyle').fontSize || '').replace(/px$/, '') || undefined} placeholder={t('\u5b57\u53f7')} allowClear options={SIZES} style={{ width: 84 }} onChange={size => editor.chain().focus().setMark('textStyle', { fontSize: size ? `${size}px` : null }).run()} />
      <Select aria-label={t('\u884c\u8ddd')} size="small" value={editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').lineHeight || undefined} placeholder={t('\u884c\u8ddd')} allowClear options={LINE_HEIGHTS} style={{ width: 76 }} onChange={lineHeight => editor.chain().focus().updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', { lineHeight }).run()} />
      <Button aria-pressed={editor.isActive('heading', { level: 1 })} size="small" type={editor.isActive('heading', { level: 1 }) ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Button>
      <Button aria-pressed={editor.isActive('heading', { level: 2 })} size="small" type={editor.isActive('heading', { level: 2 }) ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Button>
      <Button aria-pressed={editor.isActive('heading', { level: 3 })} size="small" type={editor.isActive('heading', { level: 3 }) ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Button>
      {tool(t('\u52a0\u7c97'), <BoldOutlined />, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}{tool(t('\u659c\u4f53'), <ItalicOutlined />, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}{tool(t('\u4e0b\u5212\u7ebf'), <UnderlineOutlined />, editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}{tool(t('\u5220\u9664\u7ebf'), <StrikethroughOutlined />, editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
      <Button aria-pressed={editor.isActive('subscript')} size="small" onClick={() => editor.chain().focus().toggleSubscript().run()}>X<sub>2</sub></Button><Button aria-pressed={editor.isActive('superscript')} size="small" onClick={() => editor.chain().focus().toggleSuperscript().run()}>X<sup>2</sup></Button>
      <ColorPicker aria-label={t('\u6587\u5b57\u989c\u8272')} size="small" onChange={color => editor.chain().focus().setColor(color.toHexString()).run()}><Button aria-label={t('\u6587\u5b57\u989c\u8272')} size="small" icon={<FontColorsOutlined />} /></ColorPicker><span className="rich-question-editor__divider" />
      <Button aria-label={t('\u6587\u672c\u9ad8\u4eae')} aria-pressed={editor.isActive('highlight')} size="small" type={editor.isActive('highlight') ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fff3a3' }).run()}>{t('\u9ad8\u4eae')}</Button>
      {tool(t('\u5de6\u5bf9\u9f50'), <AlignLeftOutlined />, editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run())}{tool(t('\u5c45\u4e2d'), <AlignCenterOutlined />, editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run())}{tool(t('\u53f3\u5bf9\u9f50'), <AlignRightOutlined />, editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run())}
      {tool(t('\u9879\u76ee\u7b26\u53f7'), <UnorderedListOutlined />, editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}{tool(t('\u7f16\u53f7\u5217\u8868'), <OrderedListOutlined />, editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
      <Button aria-label={t('\u589e\u52a0\u7f29\u8fdb')} size="small" onClick={() => editor.chain().focus().sinkListItem('listItem').run()} disabled={!editor.can().sinkListItem('listItem')}>+\u7f29\u8fdb</Button>
      <Button aria-label={t('\u51cf\u5c11\u7f29\u8fdb')} size="small" onClick={() => editor.chain().focus().liftListItem('listItem').run()} disabled={!editor.can().liftListItem('listItem')}>-\u7f29\u8fdb</Button>
      <Button aria-label={t('\u589e\u52a0\u6bb5\u843d\u7f29\u8fdb')} size="small" onClick={() => { const type = editor.isActive('heading') ? 'heading' : 'paragraph'; const indent = Math.min(8, Number(editor.getAttributes(type).indent || 0) + 1); editor.chain().focus().updateAttributes(type, { indent }).run(); }}>\u6bb5+</Button>
      <Button aria-label={t('\u51cf\u5c11\u6bb5\u843d\u7f29\u8fdb')} size="small" onClick={() => { const type = editor.isActive('heading') ? 'heading' : 'paragraph'; const indent = Math.max(0, Number(editor.getAttributes(type).indent || 0) - 1); editor.chain().focus().updateAttributes(type, { indent }).run(); }}>\u6bb5-</Button>
      <Button aria-pressed={editor.isActive('blockquote')} size="small" type={editor.isActive('blockquote') ? 'primary' : 'default'} onClick={() => editor.chain().focus().toggleBlockquote().run()}>{t('\u5f15\u7528')}</Button>
      <Button size="small" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>{t('\u6e05\u9664\u683c\u5f0f')}</Button>
      <Button size="small" icon={<FunctionOutlined />} onClick={() => setFormulaOpen(true)}>{t('\u516c\u5f0f')}</Button><Upload accept="image/*" showUploadList={false} beforeUpload={insertImage}><Button size="small" icon={<FileImageOutlined />}>{t('\u56fe\u7247')}</Button></Upload>
      <Button aria-label={t('\u56fe\u7247\u5bbd\u5ea6 320 \u50cf\u7d20')} size="small" disabled={!editor.isActive('image')} onClick={() => editor.chain().focus().updateAttributes('image', { width: 320 }).run()}>320px</Button>
      <Button aria-label={t('\u56fe\u7247\u5bbd\u5ea6 640 \u50cf\u7d20')} size="small" disabled={!editor.isActive('image')} onClick={() => editor.chain().focus().updateAttributes('image', { width: 640 }).run()}>640px</Button>
      <Button aria-label={t('\u56fe\u7247\u5de6\u5bf9\u9f50')} aria-pressed={editor.isActive('image', { align: 'left' })} size="small" disabled={!editor.isActive('image')} icon={<AlignLeftOutlined />} onClick={() => editor.chain().focus().updateAttributes('image', { align: 'left' }).run()} />
      <Button aria-label={t('\u56fe\u7247\u5c45\u4e2d')} aria-pressed={editor.isActive('image', { align: 'center' })} size="small" disabled={!editor.isActive('image')} icon={<AlignCenterOutlined />} onClick={() => editor.chain().focus().updateAttributes('image', { align: 'center' }).run()} />
      <Button aria-label={t('\u56fe\u7247\u53f3\u5bf9\u9f50')} aria-pressed={editor.isActive('image', { align: 'right' })} size="small" disabled={!editor.isActive('image')} icon={<AlignRightOutlined />} onClick={() => editor.chain().focus().updateAttributes('image', { align: 'right' }).run()} />
      <Button aria-label={t('\u5220\u9664\u56fe\u7247')} size="small" danger disabled={!editor.isActive('image')} icon={<DeleteOutlined />} onClick={() => editor.chain().focus().deleteSelection().run()} />
      <Input aria-label={t('\u56fe\u7247\u66ff\u4ee3\u6587\u672c')} size="small" value={imageAlt} disabled={!editor.isActive('image')} placeholder={t('\u56fe\u7247\u66ff\u4ee3\u6587\u672c')} style={{ width: 132 }} onChange={event => setImageAlt(event.target.value)} onPressEnter={() => editor.chain().focus().updateAttributes('image', { alt: imageAlt.trim() }).run()} onBlur={() => { if (editor.isActive('image')) editor.chain().focus().updateAttributes('image', { alt: imageAlt.trim() }).run(); }} />
    </Space></div>}
    <div style={{ minHeight }}><EditorContent editor={editor} /></div>
    <Modal open={formulaOpen} title={t('\u63d2\u5165 LaTeX \u516c\u5f0f')} onOk={insertFormula} onCancel={() => setFormulaOpen(false)} okText={t('\u63d2\u5165\u5e76\u663e\u793a')} cancelText={t('\u53d6\u6d88')}>
      <Input.TextArea aria-label={t('LaTeX \u516c\u5f0f')} autoFocus rows={3} value={formulaText} onChange={event => setFormulaText(event.target.value)} placeholder={'\\frac{a}{b}  /  \\sqrt{x}'} />
      <Space style={{ marginTop: 12 }}><Button aria-pressed={!blockFormula} size="small" type={!blockFormula ? 'primary' : 'default'} onClick={() => setBlockFormula(false)}>{t('\u884c\u5185\u516c\u5f0f')}</Button><Button aria-pressed={blockFormula} size="small" type={blockFormula ? 'primary' : 'default'} onClick={() => setBlockFormula(true)}>{t('\u72ec\u7acb\u516c\u5f0f')}</Button></Space>
      <div className="rich-question-editor__formula-preview" role="status" aria-live="polite">{formulaText.trim() ? <span dangerouslySetInnerHTML={{ __html: katex.renderToString(formulaText.trim().replace(/^\$+|\$+$/g, ''), { throwOnError: false, displayMode: blockFormula }) }} /> : t('\u516c\u5f0f\u9884\u89c8\u533a')}</div>
    </Modal>
  </div>;
};
export default RichQuestionEditor;
export { RichImage, Formula, FormulaBlock };
