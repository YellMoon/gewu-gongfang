'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function verifyPackagedRuntimes({appRoot=process.env.PACKAGED_APP_ROOT,spawn=spawnSync,platform=process.platform,env=process.env,log=console.log}={}){
 if(!appRoot)throw Error('PACKAGED_APP_ROOT_REQUIRED');
 const root=path.resolve(appRoot),pythonRoot=path.join(root,'runtime','python'),rubyRoot=path.join(root,'runtime','ruby'),python=path.join(pythonRoot,platform==='win32'?'python.exe':'bin/python3'),ruby=path.join(rubyRoot,'bin',platform==='win32'?'ruby.exe':'ruby');
 for(const [name,file]of [['PYTHON',python],['RUBY',ruby]])if(!fs.existsSync(file))throw Error('PACKAGED_'+name+'_RUNTIME_MISSING');
 const childEnv={...env};for(const key of ['PYTHONHOME','PYTHONPATH','PYTHONUSERBASE','GEM_HOME','GEM_PATH','RUBYLIB','RUBYOPT'])delete childEnv[key];
 const pythonCode=String.raw`import io, sys
from pathlib import Path
import docx
from docx import Document
assert Path(docx.__file__).resolve().is_relative_to(Path(sys.executable).resolve().parent)
document=Document()
document.add_paragraph('packaged-runtime')
data=io.BytesIO()
document.save(data)
data.seek(0)
assert Document(data).paragraphs[0].text=='packaged-runtime'
print('GEWU_PACKAGED_PYTHON_OK')`;
 const rubyCode=String.raw`require 'mathtype_to_mathml_plus'; root=File.realpath(ARGV[0]).downcase; files=$LOADED_FEATURES.grep(/mathtype_to_mathml_plus/); abort 'PACKAGED_GEM_ESCAPED' if files.empty? || files.any? { |f| !File.realpath(f).downcase.start_with?(root + '/') }; print 'GEWU_PACKAGED_RUBY_OK'`;
 for(const [name,file,args,token]of [['PYTHON',python,['-c',pythonCode],'GEWU_PACKAGED_PYTHON_OK'],['RUBY',ruby,['-EUTF-8:UTF-8','-e',rubyCode,rubyRoot],'GEWU_PACKAGED_RUBY_OK']]){
  const result=spawn(file,args,{cwd:root,env:childEnv,encoding:'utf8',windowsHide:true,shell:false,timeout:30000});
  if(result.error||result.status!==0||String(result.stdout).trim()!==token)throw Error('PACKAGED_'+name+'_RUNTIME_FAILED');
  log('packaged '+name.toLowerCase()+' runtime verified');
 }
 return{python:true,ruby:true};
}
if(require.main===module)verifyPackagedRuntimes();
module.exports={verifyPackagedRuntimes};
