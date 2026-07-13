const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(require.resolve('./sanitizeHtml.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = new Module(require.resolve('./sanitizeHtml.ts'));
loaded._compile(compiled, require.resolve('./sanitizeHtml.ts'));
const { sanitizeHtml } = loaded.exports;
const dom = new JSDOM('');
global.DOMParser = dom.window.DOMParser;
global.Node = dom.window.Node;

const bypass = sanitizeHtml('<section><img src="javascript:alert(1)" onerror="alert(2)"></section>');
assert(!bypass.includes('javascript:') && !bypass.includes('onerror'), 'unwrapped descendants must still be recursively sanitized');

const valid = sanitizeHtml('<span data-formula="latex" data-id="f-1" data-display-mode="inline" data-source-ref="formula/a.json" data-preview-ref="preview/a.png" data-conversion-status="complete" data-source-format="latex">x</span><img src="question-asset://asset-1" data-asset-key="asset-1" data-align="center" alt="diagram">');
assert(valid.includes('data-formula="latex"') && valid.includes('data-asset-key="asset-1"'));
assert(!sanitizeHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">').includes('src='), 'active SVG data URLs must be rejected');
const richStructure = '<h2>Heading</h2><blockquote><p>Quote</p></blockquote><ul><li>One</li></ul><ol><li>Two</li></ol><pre><code>const x = 1;</code></pre><hr>';
assert.strictEqual(sanitizeHtml(richStructure), richStructure, 'editor block and list structure must survive sanitized paste');
assert(!sanitizeHtml('<blockquote onclick="evil()"><code style="background:url(javascript:evil)">safe</code></blockquote>').includes('onclick'));
console.log('sanitizeHtml behavior tests passed');
