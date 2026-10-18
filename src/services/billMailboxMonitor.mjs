import {createPersonalFinanceClient} from './personalFinanceClient.mjs';
import {readDesktopAuthorizationSession} from './desktopAuthorizationSession.mjs';
export const billFileKey = item => JSON.stringify([item.messageId,item.attachmentId]);
export function createBillMailboxMonitor({client,readSession,isOnline=()=>true,now=Date.now}) {
 let state={scope:'',loading:false,result:null,error:null},flight=null,epoch=0,lastAttempt=0;
 const listeners=new Set(),completed=new Set();
 const identity=()=>{try{const s=readSession();return JSON.stringify([s.authContext.userId,s.authContext.activeRole,s.authContext.sessionId||s.authorization]);}catch{return '';}};
 const emit=patch=>{state={...state,...patch};for(const fn of listeners)fn(state);};
 const synchronize=()=>{const scope=identity();if(scope!==state.scope){epoch++;flight=null;lastAttempt=0;emit({scope,loading:false,result:null,error:null});}return scope;};
 async function check({automatic=false,pageToken}={}){
  const scope=synchronize();if(!scope)return null;if(!isOnline()){if(!automatic)emit({error:{code:'BILL_MAIL_OFFLINE'}});return null;}
  if(flight)return flight;
  if(automatic&&(completed.has(scope)||(lastAttempt&&now()-lastAttempt<60000)))return state.result;
  const n=epoch;lastAttempt=now();emit({loading:true,error:null});
  const current=()=>identity()===scope&&n===epoch;
  flight=(async()=>{try{const response=await client.checkMailbox(pageToken?{pageToken}:{});if(!current())return null;
   const next=response.mailbox;if(pageToken&&state.result){const items=new Map(state.result.attachments.map(item=>[billFileKey(item),item]));next.attachments.forEach(item=>items.set(billFileKey(item),item));emit({result:{...next,messageCount:state.result.messageCount+next.messageCount,attachments:[...items.values()]}});}else emit({result:next});completed.add(scope);return state.result;
  }catch(error){if(current()){emit({error:{code:error.code||'BILL_MAIL_UNAVAILABLE'}});if(/ACCESS_DENIED|NOT_CONFIGURED/.test(error.code||''))completed.add(scope);}return null;}
  finally{if(current()){flight=null;emit({loading:false});}}})();return flight;
 }
 return {check,tick:()=>check({automatic:true}),synchronize,snapshot:()=>state,subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},reset(){epoch++;flight=null;completed.clear();lastAttempt=0;emit({scope:'',loading:false,result:null,error:null});}};
}
export const billMailboxMonitor=createBillMailboxMonitor({client:{checkMailbox:input=>createPersonalFinanceClient().checkMailbox(input)},readSession:readDesktopAuthorizationSession,isOnline:()=>globalThis.navigator?.onLine!==false});
