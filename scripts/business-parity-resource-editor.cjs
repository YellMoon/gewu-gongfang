'use strict';
// UTF-8: original inputs and real cloud readback; never click a save/submit control.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,out,save,releaseNavigation})=>{
 const projection=()=>page.evaluate(()=>window.desktopIdentitySessionProvider.listCloudBusinessProjection());
 const drafts=()=>page.evaluate(()=>window.desktopAuthority.list());
 const baseline=await projection(),initialDrafts=await drafts(),results=[];
 const navigate=async(group,item)=>{
  await page.locator('.app-shell__collapse-button').click();
  const section=page.getByRole('menuitem',{name:group,exact:true});
  if(await section.getAttribute('aria-expanded')!=='true')await section.click();
  await page.getByRole('menuitem',{name:item,exact:true}).click();await releaseNavigation();
 };
 for(const [key,group,item,button,field,value,width] of [
  ['student','team 资源','user 学生','添加学生','请输入学生姓名','未保存学生',700],
  ['teacher','team 资源','team 老师','添加老师','请输入老师姓名','未保存教师',600],
  ['address','team 资源','home 上课地址','添加地址','如：302教室、线上腾讯会议','未保存地址',520],
  ['school','team 资源','bank 学校','添加学校','请输入学校名称','未保存学校',520],
  ['institution','team 资源','team 机构','添加机构','请输入机构名称','未保存机构',600],
  ['payment','dollar 财务','dollar 缴费','添加缴费记录','其他备注信息','未保存缴费备注',600],
 ]){
  await navigate(group,item);await page.getByRole('button',{name:new RegExp(button+'$')}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();const input=dialog.getByPlaceholder(field,{exact:true});await input.fill(value);
  for(let n=0;n<2;n++)await page.evaluate(()=>window.dbService.refreshAuthorityProjection());
  await dialog.waitFor();assert.equal(await input.inputValue(),value,key+' must retain unsubmitted input');
  await dialog.getByRole('button',{name:/^取\s*消$/}).hover();
  const box=await dialog.boundingBox();assert(Math.abs(box.width-width)<2,key+' original modal width');
  save('resource-editor-'+key+'-tree',await dialog.ariaSnapshot());
  await page.screenshot({path:path.join(out,'resource-editor-'+key+'.png'),scale:'css',animations:'disabled'});
  await dialog.getByRole('button',{name:/^取\s*消$/}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await drafts(),initialDrafts,key+' unfinished input is not a persisted draft');
  assert.deepEqual(await projection(),baseline,key+' readback/cancel cannot write business data');
  results.push({page:key,inputPreserved:true,cloudUnchanged:true,outboxUnchanged:true,originalWidth:box.width,cancelled:true});
  save('resource-editor-progress',results);
 }
 return {pages:results,fullUiSignoff:false};
};
