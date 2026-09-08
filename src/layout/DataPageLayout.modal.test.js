'use strict';
// UTF-8: restore the historical resource modal shell without replacing its form.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const cp = require('node:child_process');
const file = path.join(__dirname,'DataPageLayout.tsx');
const source = fs.readFileSync(file,'utf8');
assert(!/\bDrawer\b/.test(source),'resource editor must be a modal, not a side drawer');
const compiled = ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const symbols={Card:()=>null,Modal:()=>null};
const exportsObject={};
new Function('require','exports',compiled)(name=>name==='react'?React:symbols,exportsObject);
const content=React.createElement('input',{defaultValue:'原字段'});
const footer=React.createElement('button',{},'确定');
const onCancel=()=>{};
const formMarkup=text=>{
  // UTF-8: Git stores LF while this Windows checkout may use CRLF.
  const ast=ts.createSourceFile('page.tsx',text.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
  const forms=[];
  function visit(node) {
    if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='Form') forms.push(printer.printNode(ts.EmitHint.Unspecified,node,ast));
    ts.forEachChild(node,visit);
  }
  visit(ast); return forms;
};
const result=exportsObject.default({toolbar:'工具',table:'列表',modalOpen:true,modalTitle:'编辑学生',modalContent:content,modalWidth:700,modalFooter:footer,onModalCancel:onCancel,destroyOnClose:true});
const modal=React.Children.toArray(result.props.children).find(child=>child.type===symbols.Modal);
assert(modal); assert.equal(modal.props.open,true); assert.equal(modal.props.title,'编辑学生');
assert.equal(modal.props.width,'min(700px, calc(100vw - 16px))');
assert.equal(modal.props.onCancel,onCancel); assert.equal(modal.props.children,content);
assert.equal(modal.props.footer,footer); assert.equal(modal.props.destroyOnClose,true);
assert(!('onClose' in modal.props),'Modal must forward cancellation through onCancel');
for(const [name,width] of [['StudentList',700],['TeacherList',600],['InstitutionManager',600],['PaymentList',600],['RoomManager',520],['SchoolManager',520]]) {
  const page=fs.readFileSync(path.join(__dirname,'../pages',name+'.tsx'),'utf8');
  assert(!/drawer(Open|Content|Title|Width|Footer)|onDrawerClose/.test(page),name+' retains a drawer API');
  assert(page.includes('modalOpen={modalVisible}'),name+' must preserve editor visibility state');
  assert(page.includes('onModalCancel={() => setModalVisible(false)}'),name+' must preserve cancellation');
  if(width!==520) assert(page.includes('modalWidth={'+width+'}'),name+' original width');
  const prior=cp.execFileSync('git',['show','46f148bd:src/pages/'+name+'.tsx'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'});
  assert.deepEqual(formMarkup(page),formMarkup(prior),name+' form fields and handlers must not change while restoring its container');
}
console.log('resource modal shell and original width checks passed');
