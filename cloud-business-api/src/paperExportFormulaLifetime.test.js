'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { TagsFactory } = require('mathjax-full/js/input/tex/Tags.js');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { nativeFormulaComponent } = require('./wordNativeFormula');
const { renderPaperExport } = require('./paperExportRenderer');

async function verify() {
  const add = TagsFactory.add;
  const factoryBefore = {create:TagsFactory.create, setDefault:TagsFactory.setDefault, getDefault:TagsFactory.getDefault};
  const defaultBefore = TagsFactory.getDefault().constructor;
  let retainedTagClasses = 0;
  TagsFactory.add = function(name, ...args) {
    if (/^(configTags|MathtoolsTags)-/.test(name)) retainedTagClasses++;
    return add.call(this, name, ...args);
  };
  const handlersBefore = Array.from(mathjax.handlers).length;
  try {
    for (let index = 0; index < 100; index++) nativeFormulaComponent(String.raw`v=\frac{s}{t}`);
    assert.throws(() => nativeFormulaComponent(String.raw`\unknownnativecommand{x}`));
    // User macros must remain isolated between formula conversions.
    nativeFormulaComponent(String.raw`\def\localprobe{z}\localprobe`);
    assert.throws(() => nativeFormulaComponent(String.raw`\localprobe`));
    for (let index = 0; index < 3; index++) {
      await renderPaperExport({format:'pdf', title:'Lifetime', formulaMode:'word-native', snapshot:[{
        id:'lifetime-1', stem:'x', options:[], answer:'', explanation:'', assets:[],
        richContent:[{type:'formula',latex:String.raw`v=\frac{s}{t}`}],
      }]});
    }
    assert.equal(retainedTagClasses, 0, 'per-formula tagformat closures must not retain entire TeX parsers globally');
    assert.equal(Array.from(mathjax.handlers).length, handlersBefore, 'PDF conversion must not register another global HTML handler');
    for (const [name, method] of Object.entries(factoryBefore)) assert.equal(TagsFactory[name], method);
    assert.equal(TagsFactory.getDefault().constructor, defaultBefore, 'formula conversion must not change another consumer default tags');
  } finally { TagsFactory.add = add; }
  const memory = spawnSync(process.execPath, ['--expose-gc','--max-old-space-size=128',__filename,'--heap-probe'], {encoding:'utf8', windowsHide:true, timeout:60000});
  assert.equal(memory.status, 0, (memory.stderr || memory.stdout).slice(-1200));
  console.log(memory.stdout.trim());
  console.log('formula parser lifetime, handler bounds and macro isolation checks passed');
}
module.exports = verify;
if (require.main === module && process.argv.includes('--heap-probe')) {
  const samples=[];
  for(let batch=0;batch<6;batch++) {
    for(let n=0;n<100;n++) nativeFormulaComponent(String.raw`v=\frac{s}{t}`);
    global.gc(); samples.push(process.memoryUsage().heapUsed);
  }
  assert.ok(samples.at(-1)-samples[0]<8*1048576, '600 conversions must not retain a growing global parser graph');
  console.log(JSON.stringify({heapMiB:samples.map(n=>Math.round(n/1048576)),formulaCount:600}));
} else if (require.main === module) verify().catch(error => { console.error(error); process.exitCode=1; });
