'use strict';
const path=require('node:path');const {spawnSync}=require('node:child_process');
function runWithRestore(run){
 let buildError,restoreError;
 try{const status=run('dist:win:build');if(status!==0)throw Error('DESKTOP_BUILD_FAILED:'+status);}catch(error){buildError=error;}
 finally{try{const status=run('rebuild:node');if(status!==0)throw Error('NODE_RESTORE_FAILED:'+status);}catch(error){restoreError=error;}}
 if(buildError&&restoreError)throw new AggregateError([buildError,restoreError],'DESKTOP_BUILD_AND_NODE_RESTORE_FAILED');
 if(restoreError)throw restoreError;if(buildError)throw buildError;
}
if(require.main===module){
 if(!process.env.npm_execpath)throw Error('Run this script with npm run dist:win');
 runWithRestore(command=>{const result=spawnSync(process.execPath,[process.env.npm_execpath,'run',command],{cwd:path.resolve(__dirname,'..'),env:process.env,stdio:'inherit',shell:false});if(result.error)throw result.error;return result.status;});
}
module.exports={runWithRestore};
