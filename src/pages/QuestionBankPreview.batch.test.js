const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=ts.createSourceFile('QuestionBankPreview.tsx',fs.readFileSync('src/pages/QuestionBankPreview.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const handlers={};function visit(node){if(ts.isVariableDeclaration(node)&&['handleBatchTaxonomy','handleBatchGroupExam'].includes(node.name.getText(source)))handlers[node.name.getText(source)]=node.initializer.getText(source);ts.forEachChild(node,visit);}visit(source);
function handler(name,env){return new Function(...Object.keys(env),ts.transpileModule('return ('+handlers[name]+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(env));}
const rows=[{id:'a',tags:['旧标签'],taxonomy_ids:{custom:['old']}},{id:'b',tags:[],taxonomy_ids:{}}];
let failures=[],reported='',basket=[],navigation='',linked=[];
const db={getAllQuestions:()=>rows,updateQuestion:(id,patch)=>{if(id==='b')return false;Object.assign(rows[0],patch);return true;},setQuestionTaxonomyNodes:(id,system,ids)=>{linked.push({id,system,ids});return rows.find(row=>row.id===id);}};
const env={window:{dbService:db,dispatchEvent:event=>{navigation=event.detail;}},CustomEvent:class {constructor(_,data){Object.assign(this,data);}},questions:[rows[0]],selectedRowKeys:['a','b'],batchTagText:'新标签， 新标签\n第二标签, ',message:{success:text=>reported=text,warning:text=>reported=text},setSelectedRowKeys:ids=>failures=ids,setBatchTagOpen:()=>{},loadData:()=>{},setQuestionBasket:ids=>basket=ids,localStorage:{setItem:()=>{}}};
handler('handleBatchTaxonomy',env)('custom','new');assert.deepEqual(linked,[{id:'a',system:'custom',ids:['old','new']},{id:'b',system:'custom',ids:['new']}]);assert.deepEqual(failures,[],'selection across pages must not be silently skipped');
handler('handleBatchGroupExam',{...env,selectedRowKeys:['b','a','b']})();assert.deepEqual(basket,['b','a']);assert.equal(navigation,'question-bank-paper','batch composition must still open the real paper route');
console.log('actual batch tag, custom taxonomy, partial failures and paper navigation checks passed');
