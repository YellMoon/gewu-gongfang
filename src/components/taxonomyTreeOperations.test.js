const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) { const m={exports:{}}; new Function('module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports); return m.exports; }
const source='src/components/taxonomyTreeOperations.ts';
assert(fs.existsSync(source), 'current taxonomy tree must restore tested drag ordering');
const { planTaxonomyDrop, filterTaxonomyNodes } = load(source);
const nodes=[{id:'a',name:'力学',order:0},{id:'b',name:'电磁学',order:1},{id:'c',name:'运动描述',parent_id:'a',order:0},{id:'d',name:'速度',parent_id:'c',order:0}];
const reordered=planTaxonomyDrop(nodes,'b','a',-1,true);
assert.equal(reordered.find(n=>n.id==='b').order,0);assert.equal(reordered.find(n=>n.id==='a').order,1);
const moved=planTaxonomyDrop(nodes,'c','b',0,false);
assert.equal(moved.find(n=>n.id==='c').parent_id,'b');
const rooted=planTaxonomyDrop(nodes,'c','b',1,true);
assert.equal(rooted.find(n=>n.id==='c').parent_id,'','explicit empty parent clears the old parent');
assert.throws(()=>planTaxonomyDrop(nodes,'a','d',0,false),/子节点/);
assert.deepEqual(nodes.map(n=>n.order),[0,1,0,0],'planning never mutates the snapshot');
assert.deepEqual(filterTaxonomyNodes(nodes,'速度').map(n=>n.id),['a','c','d'],'search keeps ancestors');
assert.deepEqual(filterTaxonomyNodes(nodes,'力学').map(n=>n.id),['a','c','d'],'matching a chapter keeps its descendants');
console.log('taxonomy drag and search checks passed');
