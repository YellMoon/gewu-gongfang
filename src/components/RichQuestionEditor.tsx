// encoding: utf-8
import React, { useCallback, useEffect, useState } from 'react';
import { Button, ColorPicker, Input, Modal, Select, Space, Tooltip, Upload } from 'antd';
import { AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, FileImageOutlined, FontColorsOutlined, FunctionOutlined, ItalicOutlined, OrderedListOutlined, RedoOutlined, StrikethroughOutlined, UnderlineOutlined, UndoOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import type { JSONContent, NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Node, mergeAttributes } from '@tiptap/core';
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

export interface RichQuestionEditorProps { value?: string | JSONContent; onChange?: (value: string | JSONContent) => void; onHtmlChange?: (html: string) => void; output?: 'html' | 'json'; placeholder?: string; minHeight?: number; }
const t = (value: string) => value;
const FONTS = [{ value: '', label: t('\u9ed8\u8ba4\u5b57\u4f53') }, { value: 'SimSun', label: t('\u5b8b\u4f53') }, { value: 'Microsoft YaHei', label: t('\u5fae\u8f6f\u96c5\u9ed1') }, { value: 'KaiTi', label: t('\u6977\u4f53') }, { value: 'FangSong', label: t('\u4eff\u5b8b') }, { value: 'Arial', label: 'Arial' }, { value: 'Times New Roman', label: 'Times New Roman' }];
const SIZES = ['12', '14', '16', '18', '20', '24', '28', '32'].map(value => ({ value, label: `${value}px` }));
const RichTextStyle = TextStyle.extend({ addAttributes() { return { ...this.parent?.(), fontSize: { default: null, parseHTML: element => element.style.fontSize || null, renderHTML: attrs => attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {} } }; } });
const RichImage = Image.extend({ addAttributes() { return { ...this.parent?.(), assetKey: { default: null }, width: { default: null }, align: { default: 'center', renderHTML: attrs => ({ 'data-align': attrs.align }) } }; } });

const FormulaView: React.FC<NodeViewProps> = ({ node, selected }) => {
  const latex = String(node.attrs.canonicalLatex || '');
  const html = katex.renderToString(latex, { throwOnError: false, displayMode: node.attrs.displayMode === 'block' });
  return <NodeViewWrapper as="span" className={`rich-formula-node${selected ? ' is-selected' : ''}`} data-latex={latex}><span dangerouslySetInnerHTML={{ __html: html }} /></NodeViewWrapper>;
};
const Formula = Node.create({
  name: 'formula', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { id: { default: null }, canonicalLatex: { default: '' }, displayMode: { default: 'inline' } }; },
  parseHTML() { return [{ tag: 'span[data-formula]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-formula': 'latex', 'data-latex': HTMLAttributes.canonicalLatex })]; },
  addNodeView() { return ReactNodeViewRenderer(FormulaView); },
});

const RichQuestionEditor: React.FC<RichQuestionEditorProps> = ({ value = '', onChange, onHtmlChange, output = 'html', placeholder, minHeight = 160 }) => {
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaText, setFormulaText] = useState('');
  const [blockFormula, setBlockFormula] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit, RichTextStyle, Color, FontFamily, Underline, Highlight.configure({ multicolor: true }), Subscript, Superscript, TextAlign.configure({ types: ['heading', 'paragraph'] }), RichImage.configure({ allowBase64: true }), Formula],
    content: value || '',
    editorProps: { attributes: { class: 'rich-question-editor__surface', 'data-placeholder': placeholder || '' } },
    onCreate: ({ editor: current }) => { if (output === 'json') { onChange?.(current.getJSON()); onHtmlChange?.(current.getHTML()); } },
    onUpdate: ({ editor: current }) => { onChange?.(output === 'json' ? current.getJSON() : current.getHTML()); onHtmlChange?.(current.getHTML()); },
  });
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = output === 'json' ? JSON.stringify(editor.getJSON()) : editor.getHTML();
    const incoming = output === 'json' ? JSON.stringify(value || { type: 'doc', content: [] }) : String(value || '');
    if (current !== incoming) editor.commands.setContent(value || '', false);
  }, [editor, output, value]);
  const insertImage = useCallback((file: File) => { const reader = new FileReader(); reader.onload = () => editor?.chain().focus().setImage({ src: String(reader.result || ''), alt: file.name }).run(); reader.readAsDataURL(file); return false; }, [editor]);
  if (!editor) return null;
  const insertFormula = () => { const latex = formulaText.trim().replace(/^\$+|\$+$/g, ''); if (!latex) return; editor.chain().focus().insertContent({ type: 'formula', attrs: { id: `formula-${Date.now()}`, canonicalLatex: latex, displayMode: blockFormula ? 'block' : 'inline' } }).run(); setFormulaText(''); setFormulaOpen(false); };
  const tool = (title: string, icon: React.ReactNode, active: boolean, run: () => void) => <Tooltip title={title}><Button size="small" type={active ? 'primary' : 'default'} icon={icon} onClick={run} /></Tooltip>;
  return <div className="rich-question-editor">
    <div className="rich-question-editor__toolbar" role="toolbar"><Space size={4} wrap>
      {tool(t('\u64a4\u9500'), <UndoOutlined />, false, () => editor.chain().focus().undo().run())}{tool(t('\u91cd\u505a'), <RedoOutlined />, false, () => editor.chain().focus().redo().run())}<span className="rich-question-editor__divider" />
      <Select size="small" value={editor.getAttributes('textStyle').fontFamily || ''} options={FONTS} style={{ width: 132 }} onChange={font => font ? editor.chain().focus().setFontFamily(font).run() : editor.chain().focus().unsetFontFamily().run()} />
      <Select size="small" placeholder={t('\u5b57\u53f7')} allowClear options={SIZES} style={{ width: 84 }} onChange={size => editor.chain().focus().setMark('textStyle', { fontSize: size ? `${size}px` : null }).run()} />
      {tool(t('\u52a0\u7c97'), <BoldOutlined />, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}{tool(t('\u659c\u4f53'), <ItalicOutlined />, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}{tool(t('\u4e0b\u5212\u7ebf'), <UnderlineOutlined />, editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}{tool(t('\u5220\u9664\u7ebf'), <StrikethroughOutlined />, editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
      <Button size="small" onClick={() => editor.chain().focus().toggleSubscript().run()}>X<sub>2</sub></Button><Button size="small" onClick={() => editor.chain().focus().toggleSuperscript().run()}>X<sup>2</sup></Button>
      <ColorPicker size="small" onChange={color => editor.chain().focus().setColor(color.toHexString()).run()}><Button size="small" icon={<FontColorsOutlined />} /></ColorPicker><span className="rich-question-editor__divider" />
      {tool(t('\u5de6\u5bf9\u9f50'), <AlignLeftOutlined />, false, () => editor.chain().focus().setTextAlign('left').run())}{tool(t('\u5c45\u4e2d'), <AlignCenterOutlined />, false, () => editor.chain().focus().setTextAlign('center').run())}{tool(t('\u53f3\u5bf9\u9f50'), <AlignRightOutlined />, false, () => editor.chain().focus().setTextAlign('right').run())}
      {tool(t('\u9879\u76ee\u7b26\u53f7'), <UnorderedListOutlined />, editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}{tool(t('\u7f16\u53f7\u5217\u8868'), <OrderedListOutlined />, editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
      <Button size="small" icon={<FunctionOutlined />} onClick={() => setFormulaOpen(true)}>{t('\u516c\u5f0f')}</Button><Upload accept="image/*" showUploadList={false} beforeUpload={insertImage}><Button size="small" icon={<FileImageOutlined />}>{t('\u56fe\u7247')}</Button></Upload>
    </Space></div>
    <div style={{ minHeight }}><EditorContent editor={editor} /></div>
    <Modal open={formulaOpen} title={t('\u63d2\u5165 LaTeX \u516c\u5f0f')} onOk={insertFormula} onCancel={() => setFormulaOpen(false)} okText={t('\u63d2\u5165\u5e76\u663e\u793a')} cancelText={t('\u53d6\u6d88')}>
      <Input.TextArea autoFocus rows={3} value={formulaText} onChange={event => setFormulaText(event.target.value)} placeholder={'\\frac{a}{b}  /  \\sqrt{x}'} />
      <Space style={{ marginTop: 12 }}><Button size="small" type={!blockFormula ? 'primary' : 'default'} onClick={() => setBlockFormula(false)}>{t('\u884c\u5185\u516c\u5f0f')}</Button><Button size="small" type={blockFormula ? 'primary' : 'default'} onClick={() => setBlockFormula(true)}>{t('\u72ec\u7acb\u516c\u5f0f')}</Button></Space>
      <div className="rich-question-editor__formula-preview">{formulaText.trim() ? <span dangerouslySetInnerHTML={{ __html: katex.renderToString(formulaText.trim().replace(/^\$+|\$+$/g, ''), { throwOnError: false, displayMode: blockFormula }) }} /> : t('\u516c\u5f0f\u9884\u89c8\u533a')}</div>
    </Modal>
  </div>;
};
export default RichQuestionEditor;
