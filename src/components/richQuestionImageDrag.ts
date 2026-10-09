import type { Editor } from '@tiptap/core';
import { flushSync } from 'react-dom';
import { maskPersistedImagesForEditor, restorePersistedImagesFromEditor } from './richQuestionEditorState';

const imageDragType = 'application/x-gewu-question-image';
let activeDrag: { token: string; editor: Editor; getPos: () => number | undefined } | null = null;

export function beginQuestionImageDrag(editor: Editor, getPos: () => number | undefined, transfer: DataTransfer) {
  if (!editor.isEditable) return;
  const pos = getPos();
  if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos)?.type.name !== 'image') return;
  editor.commands.setNodeSelection(pos);
  const token = crypto.randomUUID();
  activeDrag = { token, editor, getPos };
  transfer.setData(imageDragType, token);
  transfer.effectAllowed = 'move';
}

export function endQuestionImageDrag() { activeDrag = null; }

/** Move the persisted image atom; displayed data URLs never enter saved content. */
export function dropQuestionImage(target: Editor, event: DragEvent): boolean {
  const source = activeDrag;
  if (!source || !event.dataTransfer || source.editor.isDestroyed) return false;
  let from: number | undefined;
  try { from = source.getPos(); } catch { return false; }
  const node = typeof from === 'number' ? source.editor.state.doc.nodeAt(from) : null;
  const token = event.dataTransfer.getData(imageDragType);
  // ProseMirror clears custom transfer data after our dragstart handler. Accept
  // that native gesture only when its single dragged atom is this image.
  const nativeSlice = source.editor.view.dragging?.slice.content;
  const nativeImage = node?.type.name === 'image' && nativeSlice?.childCount === 1 && nativeSlice.firstChild?.eq(node);
  if (token ? token !== source.token : !nativeImage) return false;
  event.preventDefault();
  activeDrag = null;
  if (!target.isEditable || source.editor.isDestroyed || !source.editor.isEditable) return true;
  const destination = target.view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (typeof from !== 'number' || node?.type.name !== 'image' || !destination) return true;
  if (source.editor === target) {
    if (destination.pos >= from && destination.pos <= from + node.nodeSize) return true;
    const transaction = target.state.tr.delete(from, from + node.nodeSize);
    const position = transaction.mapping.map(destination.pos);
    transaction.replaceRangeWith(position, position, node);
    target.view.dispatch(transaction.scrollIntoView());target.commands.focus();
  } else {
    const persisted = restorePersistedImagesFromEditor(node.toJSON());
    // The target and source editors emit complete question documents. Commit
    // the target update before deleting the source so its callback sees the
    // new document instead of overwriting the inserted image with stale state.
    let inserted = false;
    flushSync(() => { inserted = target.chain().focus().insertContentAt(destination.pos, maskPersistedImagesForEditor(persisted)).run(); });
    if (inserted) {
      source.editor.commands.deleteRange({ from, to: from + node.nodeSize });
    }
  }
  return true;
}
