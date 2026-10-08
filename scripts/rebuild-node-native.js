'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
function rebuildEnvironment({environment=process.env,version=process.versions.node,platform=process.platform}={}){
 const env={...environment};
 for(const key of Object.keys(env))if(/^(?:npm_config_|npm_package_config_node_gyp_)(?:target|runtime|disturl|nodedir|build_from_source)$|^electron_run_as_node$/i.test(key))delete env[key];
 env.npm_config_runtime='node';env.npm_config_disturl='https://nodejs.org/download/release';
 const [major,minor]=version.split('.').map(Number);
 if(platform==='win32'&&major===24&&minor>=19){
  // Node 24 backported ObjectWrap header cleanup hooks before the matching runtime fix.
  // ABI 137 stays compatible; compile against the verified pre-hook headers while running
  // the current patched Node executable. Do not downgrade the Node runtime.
  // Upstream: https://github.com/nodejs/node/issues/65262 and /issues/65195.
  env.npm_config_target='24.15.0';env.npm_config_build_from_source='true';
 }
 return env;
}
function rebuildNodeNative(){
 if(process.versions.electron)throw Error('NODE_NATIVE_REBUILD_REQUIRES_NODE_RUNTIME');
 const root=path.resolve(__dirname,'..');const npmCli=process.env.npm_execpath;
 if(!npmCli||!fs.existsSync(npmCli))throw Error('Run this script with npm run rebuild:node');
 const env=rebuildEnvironment();
 for(const scope of ['', 'backend']){
  console.log('Rebuilding Node SQLite '+(scope||'root')+'; runtime='+process.versions.node+'; headers='+(env.npm_config_target||process.versions.node));
  const result=spawnSync(process.execPath,[npmCli,'rebuild','better-sqlite3'],{cwd:path.join(root,scope),env,stdio:'inherit',shell:false});
  if(result.error)throw result.error;if(result.status!==0)throw Error('NODE_NATIVE_REBUILD_FAILED:'+scope+':'+result.status);
 }
 for(const script of ['scripts/verify-electron-native-abi.js','scripts/verify-node-native-gc.js','backend/src/services/questionBankService.test.js']){
  const result=spawnSync(process.execPath,[path.join(root,script)],{cwd:root,env,stdio:'inherit',timeout:180000,shell:false});
  if(result.error)throw result.error;if(result.status!==0)throw Error('NODE_NATIVE_RUNTIME_FAILED:'+script+':'+result.status);
 }
}
if(require.main===module)rebuildNodeNative();
module.exports={rebuildEnvironment,rebuildNodeNative};
