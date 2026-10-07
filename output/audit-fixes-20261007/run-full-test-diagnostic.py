import json, os, subprocess, time
from pathlib import Path
root=Path.cwd(); evidence=root/'output/audit-fixes-20261007'
env=dict(os.environ); env['NODE_OPTIONS']='--require='+str(evidence/'diagnostic-no-opt.cjs')
with (evidence/'npm-test-final8.log').open('wb') as log:
    task=subprocess.Popen(['cmd.exe','/d','/c','npm test'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    while task.poll() is None:
        print('npm test running; diagnostic V8 optimization disabled; '+time.strftime('%H:%M:%S'),flush=True)
        try: task.wait(timeout=25)
        except subprocess.TimeoutExpired: pass
result={'exitCode':task.returncode,'mode':'V8 no-opt via diagnostic preload; WebAssembly remains enabled','command':'npm test'}
(evidence/'npm-test-final8-result.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result),flush=True)
raise SystemExit(0 if task.returncode==0 else 1)
