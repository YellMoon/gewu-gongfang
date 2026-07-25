async(page)=>{
  await page.addInitScript(()=>{
    window.api={invoke:async ch=>ch==="runtime-config:get"?{
      nodeRole:"desktop-client",deviceId:"client-1",hostBaseUrl:"http://127.0.0.1:3001",cloudBaseUrl:"http://127.0.0.1:3001",
      desktopSyncToken:"",mainDbPath:"",questionBankPath:"",questionAssetPath:"",questionBankCandidatePaths:[],questionBankStoreId:"",localCachePath:"",nasBackupPath:""
    }:null};
    localStorage.setItem("question_basket_selected",JSON.stringify(["q1"]));
    localStorage.setItem("question_basket_ids",JSON.stringify(["q1"]));
    localStorage.setItem("gewu_paper_export_tasks_v1",JSON.stringify([{
      localId:"paper-slow",serverTaskId:"task-slow",idempotencyKey:"idem-slow",
      request:{title:"\u53d6\u6d88\u6d41\u7a0b\u9a8c\u8bc1",format:"word",formulaMode:"word-native",questionIds:["q1"],answerPosition:"end",subject:"\u7269\u7406"},
      status:"processing",phase:"rendering",progress:55,accepted:true,createdAt:"2026-07-14T00:00:00.000Z",updatedAt:"2026-07-14T00:00:00.000Z",message:"\u6b63\u5728\u751f\u6210\u6587\u6863",errorCode:"",result:null
    }]));
  });
  await page.route("**/api/question-bank/questions?limit=1000",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({success:true,data:[{
    id:"q1",subject:"\u7269\u7406",type:"\u5355\u9009\u9898",difficulty:2,stem:"x^2+y^2",options:["A","B"],answer:"A",analysis:"analysis",status:"published"
  }]})}));
  await page.route("http://127.0.0.1:3001/api/cloud/tasks/task-slow/result",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({success:true,task:{id:"task-slow",status:"processing",phase:"rendering",progress:55,message:"\u6b63\u5728\u751f\u6210\u6587\u6863"}})}));
  await page.route("http://127.0.0.1:3001/api/cloud/tasks/task-slow/cancel",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({success:true,task:{id:"task-slow",status:"cancelled",phase:"cancelled",progress:55,message:"\u4efb\u52a1\u5df2\u53d6\u6d88"}})}));
  await page.goto("http://127.0.0.1:3000");
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("navigate-page",{detail:"question-bank-paper"})));
  await page.getByText("\u53d6\u6d88\u6d41\u7a0b\u9a8c\u8bc1").waitFor();
}
