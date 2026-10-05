// UTF-8: exercise actual card handlers, including nested controls and keyboard use.
const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),React=require('react');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client');const {act}=React;
const antd={Button:({children,icon,type, ...props})=>React.createElement('button',props,children),Space:({children})=>React.createElement('div',null,children),Checkbox:props=>React.createElement('input',{type:'checkbox',...props}),Popconfirm:({children})=>children};
const moduleObject={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('src/components/QuestionPreviewCard.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText)(name=>{
 if(name==='react')return React;if(name==='antd')return antd;if(name==='@ant-design/icons')return new Proxy({},{get:()=>()=>null});
 if(name.endsWith('.css'))return {};if(name.includes('questionAssetStore'))return {isAssetRef:()=>false};
 if(name==='./StructuredQuestionViewer')return {__esModule:true,default:({showAnswer,value})=>React.createElement('div',{'data-testid':'stem'},'题干',showAnswer&&React.createElement('span',{'data-testid':'answer'},value.sections.answer.text))};
 return {__esModule:true,default:()=>null};
},moduleObject,moduleObject.exports);
(async()=>{let edited=0,basket=0;const root=createRoot(document.getElementById('root'));const question={id:'q',content:'题干',rich_content:{type:'question-document',sections:{answer:{type:'text',text:'答案'}}}};
 await act(async()=>root.render(React.createElement(moduleObject.exports.default,{question,onEdit:()=>edited++,onToggleBasket:()=>basket++})));
 const click=async selector=>act(async()=>document.querySelector(selector).dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
 assert(!document.querySelector('[data-testid=answer]'));
 assert(!document.querySelector('.qb-answer-button'),'the removed answer button must not return');
 await click('[data-testid=stem]');assert(document.querySelector('[data-testid=answer]'),'clicking the stem must expand answers');
 await click('.qb-edit-button');assert.equal(edited,1);assert(document.querySelector('[data-testid=answer]'),'edit must not toggle answers');
 await click('.qb-basket-button');assert.equal(basket,1);assert(document.querySelector('[data-testid=answer]'));
 await click('.qb-card-source-line');assert(document.querySelector('.qb-answer-drawer[aria-hidden=true]'),'clicking card whitespace/footer must collapse');
 const updated={...question,rich_content:{...question.rich_content,sections:{answer:{type:'text',text:'修改后的答案'}}}};
 await act(async()=>root.render(React.createElement(moduleObject.exports.default,{question:updated,showAnswer:true})));
 assert.equal(document.querySelector('[data-testid=answer]').textContent,'修改后的答案','editing only an answer must invalidate preview assets/content cache');
 await act(async()=>root.unmount());console.log('whole-card answer, edit cache and nested control interactions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
