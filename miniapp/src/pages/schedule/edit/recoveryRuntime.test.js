'use strict';
// UTF-8: The retired edit route must remain read-only and recover from a direct launch.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function page(back){const calls=[];const jsx=(type,props)=>({type,props:props||{}});const deps={
 '@tarojs/components':{Text:'Text',View:'View'},'react/jsx-runtime':{jsx,jsxs:jsx},'./edit.scss':{},
 '@tarojs/taro':{default:{navigateBack:async()=>{calls.push('back');return back();},switchTab:async o=>calls.push(o.url)}}};
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'index.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(name=>{assert.ok(Object.hasOwn(deps,name),'no business service is allowed');return deps[name];},m,m.exports);return {tree:m.exports.default(),calls};}
(async()=>{for(const fails of [false,true]){const p=page(async()=>{if(fails)throw Error('no previous page');});await p.tree.props.children[1].props.onClick();assert.deepEqual(p.calls,fails?['back','/pages/index/index']:['back']);}console.log('schedule edit read-only route normal/direct-launch return checks passed');})().catch(e=>{console.error(e);process.exitCode=1;});
