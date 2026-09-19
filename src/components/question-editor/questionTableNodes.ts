import { Node, mergeAttributes } from '@tiptap/core';

// Schema-only support: preserve imported tables without adding editing tools or
// changing the existing question editor workflow.
const QuestionTable = Node.create({
  name: 'table', group: 'block', content: 'tableRow+', isolating: true,
  parseHTML() { return [{ tag: 'table' }]; },
  renderHTML({ HTMLAttributes }) { return ['table', mergeAttributes(HTMLAttributes, { class: 'question-table' }), ['tbody', 0]]; },
});
const QuestionTableRow = Node.create({
  name: 'tableRow', content: '(tableCell | tableHeader)*',
  parseHTML() { return [{ tag: 'tr' }]; },
  renderHTML() { return ['tr', 0]; },
});
function cellNode(name: string, tag: string) {
  return Node.create({
    name, content: 'block+', isolating: true,
    addAttributes() {
      return Object.fromEntries(['colspan', 'rowspan'].map(key => [key, {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute(key));
          return Number.isInteger(value) && value > 0 && value <= 1000 ? value : 1;
        },
      }]));
    },
    parseHTML() { return [{ tag }]; },
    renderHTML({ HTMLAttributes }) { return [tag, HTMLAttributes, 0]; },
  });
}
export const QuestionTableNodes = [QuestionTable, QuestionTableRow, cellNode('tableCell', 'td'), cellNode('tableHeader', 'th')];
