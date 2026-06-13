import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Space, Tooltip, Upload } from 'antd';
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  DeleteOutlined,
  FileImageOutlined,
  FunctionOutlined,
  ItalicOutlined,
  UnderlineOutlined,
} from '@ant-design/icons';

interface RichQuestionEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

const formulaHint = '输入 LaTeX，例如 \\frac{a}{b} 或 \\sqrt{x}，保存后由 KaTeX 渲染。';

const RichQuestionEditor: React.FC<RichQuestionEditorProps> = ({
  value = '',
  onChange,
  placeholder,
  minHeight = 160,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaText, setFormulaText] = useState('');
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || focused) return;
    if (editor.innerHTML !== (value || '')) editor.innerHTML = value || '';
  }, [value, focused]);

  const emitChange = () => {
    onChange?.(editorRef.current?.innerHTML || '');
  };

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const runCommand = (command: string, commandValue?: string) => {
    focusEditor();
    document.execCommand(command, false, commandValue);
    emitChange();
  };

  const insertFormula = () => {
    const latex = formulaText.trim();
    if (!latex) return;
    runCommand('insertHTML', `$${latex}$`);
    setFormulaText('');
    setFormulaOpen(false);
  };

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src) return;
      runCommand('insertHTML', `<img src="${src}" style="max-width:100%;height:auto;margin:6px 4px;vertical-align:middle;" />`);
    };
    reader.readAsDataURL(file);
    return false;
  };

  const applyImageAlignment = (alignment: 'left' | 'center' | 'right') => {
    const image = selectedImage;
    if (!image) return;
    image.style.display = 'block';
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
    image.style.marginTop = '6px';
    image.style.marginBottom = '6px';
    image.style.marginLeft = alignment === 'left' ? '0' : alignment === 'center' ? 'auto' : 'auto';
    image.style.marginRight = alignment === 'right' ? '0' : alignment === 'center' ? 'auto' : 'auto';
    emitChange();
  };

  const deleteSelectedImage = () => {
    if (!selectedImage) return;
    selectedImage.remove();
    setSelectedImage(null);
    emitChange();
  };

  const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = (event) => {
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    if (!html && !text) return;
    event.preventDefault();
    runCommand('insertHTML', html || text.replace(/\n/g, '<br />'));
  };

  return (
    <div className="rich-question-editor">
      <Space size={4} wrap className="rich-question-editor__toolbar">
        <Tooltip title="加粗"><Button size="small" icon={<BoldOutlined />} onClick={() => runCommand('bold')} /></Tooltip>
        <Tooltip title="斜体"><Button size="small" icon={<ItalicOutlined />} onClick={() => runCommand('italic')} /></Tooltip>
        <Tooltip title="下划线"><Button size="small" icon={<UnderlineOutlined />} onClick={() => runCommand('underline')} /></Tooltip>
        <Tooltip title="插入公式"><Button size="small" icon={<FunctionOutlined />} onClick={() => setFormulaOpen(true)} /></Tooltip>
        <Upload accept="image/*" showUploadList={false} beforeUpload={insertImage}>
          <Tooltip title="上传图片"><Button size="small" icon={<FileImageOutlined />} /></Tooltip>
        </Upload>
        <Tooltip title="图片左对齐"><Button size="small" icon={<AlignLeftOutlined />} disabled={!selectedImage} onClick={() => applyImageAlignment('left')} /></Tooltip>
        <Tooltip title="图片居中"><Button size="small" icon={<AlignCenterOutlined />} disabled={!selectedImage} onClick={() => applyImageAlignment('center')} /></Tooltip>
        <Tooltip title="图片右对齐"><Button size="small" icon={<AlignRightOutlined />} disabled={!selectedImage} onClick={() => applyImageAlignment('right')} /></Tooltip>
        <Tooltip title="删除图片"><Button size="small" danger icon={<DeleteOutlined />} disabled={!selectedImage} onClick={deleteSelectedImage} /></Tooltip>
      </Space>
      <div
        ref={editorRef}
        className="rich-question-editor__surface"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); emitChange(); }}
        onInput={emitChange}
        onPaste={handlePaste}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          setSelectedImage(target.tagName === 'IMG' ? target as HTMLImageElement : null);
        }}
      />
      <Modal
        open={formulaOpen}
        title="插入公式"
        onOk={insertFormula}
        onCancel={() => setFormulaOpen(false)}
        okText="插入"
        cancelText="取消"
      >
        <Input.TextArea
          rows={3}
          value={formulaText}
          onChange={event => setFormulaText(event.target.value)}
          placeholder={formulaHint}
        />
      </Modal>
    </div>
  );
};

export default RichQuestionEditor;
