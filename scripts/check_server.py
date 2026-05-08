import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=t)
    out = stdout.read().decode('utf-8', errors='replace')
    print(out[:3000])

run("pm2 status 2>&1 || true")
run("curl -s http://localhost:3001/api/health 2>&1 || echo FAIL")
run("curl -s http://localhost:3001/api/students 2>&1 | head -c 300 || echo FAIL")
ssh.close()
