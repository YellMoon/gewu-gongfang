'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const modules = {};
function collect(file) {
  const id = path.relative(root,file).replace(/\\/g,'/');
  if(modules[id]) return id;
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const deps = {};
  modules[id]={code,deps};
  for(const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const name=match[1]; if(!name.startsWith('.') || name.endsWith('.css')) continue;
    const base=path.resolve(path.dirname(file),name);
    const candidate=[base,...['.ts','.tsx','.mjs','.js','/index.ts'].map(ext=>base+ext)].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
    if(!candidate) throw new Error('Unresolved '+name+' in '+id);
    deps[name]=collect(candidate);
  }
  return id;
}
const entry=collect(path.join(__dirname,'RevenueStatistics.tsx'));
const data={
  students:[{id:'s-a',name:'机构学生甲',source_type:2,institution_id:'jianren'},{id:'s-b',name:'机构学生乙',source_type:2,institution_id:'other'}],
  teachers:[{id:'t-a',name:'教师甲'},{id:'t-b',name:'教师乙'},{id:'t-unused',name:'无排课教师'}],
  institutions:[{id:'jianren',name:'建人高复'},{id:'other',name:'其他机构'},{id:'unused',name:'无排课机构'}],
  courses:[
    {id:'c-a',name:'理8班',type:4,source_type:2,institution_id:'jianren',year:2026,semester:'秋学期',teacher_id:'t-a',default_duration_minutes:40,billing_unit:2,student_pricings:[{student_id:'s-a',tuition:100,teacher_fee:60}]},
    {id:'c-b',name:'其他课程',type:1,source_type:2,institution_id:'other',year:2025,semester:'春学期',teacher_id:'t-b',billing_unit:1,student_pricings:[{student_id:'s-b',tuition:100,teacher_fee:60}]},
  ],
  schedules:[
    {id:'a',course_id:'c-a',teacher_id:'t-a',start_time:'2026-09-21 17:30',end_time:'2026-09-21 18:10',status:1},
    {id:'b',course_id:'c-b',teacher_id:'t-b',start_time:'2026-10-31 17:30',end_time:'2026-10-31 18:30',status:1},
  ],
};
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1450,height:1050}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://revenue-fixture.test/',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://revenue-fixture.test/');
    for(const file of ['react/umd/react.production.min.js','react-dom/umd/react-dom.production.min.js','dayjs/dayjs.min.js','antd/dist/antd.min.js']) await page.addScriptTag({path:path.join(root,'node_modules',file)});
    await page.addStyleTag({path:path.join(root,'src/index.css')});
    await page.evaluate(({modules,entry,data})=>{
      const cache={};
      function load(id) {
        if(cache[id])return cache[id].exports;
        const module={exports:{}};cache[id]=module;
        new Function('require','module','exports',modules[id].code)(name=>{
          if(name==='react')return window.React;if(name==='antd')return window.antd;if(name==='dayjs')return window.dayjs;
          if(name.endsWith('.css'))return {};
          if(name==='@ant-design/icons')return new Proxy({},{get:()=>()=>null});
          if(name==='chart.js')return new Proxy({Chart:{register(){}}},{get:(target,key)=>target[key]||{}});
          if(name==='react-chartjs-2')return {Bar:()=>null,Line:()=>null,Pie:()=>null};
          if(modules[id].deps[name])return load(modules[id].deps[name]);throw new Error('Unsupported '+name);
        },module,module.exports);return module.exports;
      }
      window.dbService={getAllCourses:()=>data.courses,getAllStudents:()=>data.students,getAllTeachers:()=>data.teachers,getAllInstitutions:()=>data.institutions,getAllSchedules:()=>data.schedules,getAllPayments:()=>[],getAllConsumptions:()=>[]};
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(load(entry).default));
    },{modules,entry,data});
    await page.getByPlaceholder('开始日期').waitFor();
    async function options(label) {
      const field=page.locator('.ant-col').filter({has:page.locator('span').filter({hasText:new RegExp('^'+label+'：$')})}).first();
      await field.locator('.ant-select-selector').click();
      const dropdown=page.locator('.ant-select-dropdown:visible');
      await dropdown.waitFor();
      const values=await dropdown.locator('.ant-select-item-option-content').allTextContents();
      await page.keyboard.press('Escape');await dropdown.waitFor({state:'hidden'});return values;
    }
    async function select(label,text) {
      const field=page.locator('.ant-col').filter({has:page.locator('span').filter({hasText:new RegExp('^'+label+'：$')})}).first();
      await field.locator('.ant-select-selector').click();
      const dropdown=page.locator('.ant-select-dropdown:visible');
      await dropdown.locator('.ant-select-item-option-content').filter({hasText:text}).click();
      await dropdown.waitFor({state:'hidden'});
    }
    async function date(placeholder,value) {await page.getByPlaceholder(placeholder).fill(value);await page.getByPlaceholder(placeholder).press('Enter');}
    await date('开始日期','2026-09-01');await date('结束日期','2026-10-31');
    assert.deepEqual((await options('机构')).sort(),['其他机构','建人高复'].sort());
    assert(!(await options('老师')).includes('无排课教师'));
    for (const [label, value, institution] of [
      ['老师','教师甲','建人高复'],['年份','2025','其他机构'],['学期','春学期','其他机构'],
      ['课程名','理8班','建人高复'],['学生','机构学生甲','建人高复'],['课程类型','大班课','建人高复'],
    ]) {
      await select(label,value);
      assert.deepEqual(await options('机构'),[institution],`${label} selection must immediately narrow other facets`);
      const field=page.locator('.ant-col').filter({has:page.locator('span').filter({hasText:new RegExp('^'+label+'：$')})}).first();
      await field.hover();await field.locator('.ant-select-clear').click();
      assert.deepEqual((await options('机构')).sort(),['其他机构','建人高复'].sort(),`${label} clearing must restore valid alternatives`);
    }
    await select('机构','建人高复');
    assert.deepEqual(await options('老师'),['教师甲']);
    assert.deepEqual(await options('学生'),['机构学生甲']);
    assert.deepEqual(await options('年份'),['2026']);
    assert.deepEqual(await options('学期'),['秋学期']);
    assert.deepEqual(await options('课程类型'),['大班课']);
    assert((await options('课程名')).every(label=>label.includes('理8班')));
    await page.getByRole('button',{name:'筛选',exact:true}).click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ant-statistic')).some(el=>el.textContent.includes('应收学费')&&el.textContent.includes('100.00')));
    const output=path.join(root,'output/playwright/revenue-facets-20261001');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'jianren-september-october.png'),fullPage:true});
    await date('开始日期','2026-10-01');
    assert.deepEqual(await options('机构'),['其他机构'],'date changes narrow immediately before clicking Filter');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({fixture:true,liveCloud:false,errors,checks:'current draft dates; all seven facet lists; changing and clearing each teacher/year/semester/course/student/type; selecting Jianren returns 100.00 fixture tuition'},null,2));
    console.log('RevenueStatistics actual component browser checks passed; '+output);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
