const assert = require('assert');
const { questionBankBindingPresentation, bindQuestionBankStore } = require('./questionBankBindingUi');
assert.strictEqual(questionBankBindingPresentation({}).bound, false);
assert.strictEqual(questionBankBindingPresentation({ binding: { store_id: 's', db_authority_id: 'd' } }).authority, 'd');
(async()=>{let options;await bindQuestionBankStore(async(_u,o)=>(options=o,{ok:true,status:200,json:async()=>({success:true})}),'x',{root:'r'},{authorization:'Bearer t',authContext:{deviceId:'dev'}});assert.strictEqual(options.headers['x-device-id'],'dev');console.log('question bank binding UI tests passed');})().catch(e=>{console.error(e);process.exit(1)});
