'use strict';
const { TagsFactory } = require('mathjax-full/js/input/tex/Tags.js');

// MathJax 3 tagformat AND mathtools create a globally registered class which
// closes over each new parser. Keep the registry local during synchronous
// conversion, retaining all packages and fresh-parser macro isolation. No await
// may occur in this scope; finally also restores the factory after invalid TeX.
function withFormulaTagScope(convert) {
  const add = TagsFactory.add;
  const create = TagsFactory.create;
  const setDefault = TagsFactory.setDefault;
  const getDefault = TagsFactory.getDefault;
  let defaultName = null;
  const local = new Map();
  TagsFactory.add = (name, constructor) => { local.set(name, constructor); };
  TagsFactory.create = name => local.has(name) ? new (local.get(name))() : create.call(TagsFactory, name);
  TagsFactory.setDefault = name => { defaultName = name; };
  TagsFactory.getDefault = () => defaultName === null ? getDefault.call(TagsFactory) : TagsFactory.create(defaultName);
  try { return convert(); }
  finally {
    TagsFactory.add = add; TagsFactory.create = create;
    TagsFactory.setDefault = setDefault; TagsFactory.getDefault = getDefault;
  }
}
module.exports = Object.freeze({ withFormulaTagScope });
