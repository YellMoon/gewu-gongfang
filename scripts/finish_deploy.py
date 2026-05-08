import paramiko, time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)
print("已连接")

def run(cmd, t=300):
    print(f">>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=t)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out.strip(): print(out[:2000])
    if err.strip(): print("ERR:", err[:500])
    return out

run("cd /root/scheduling-backend && npm install --production 2>&1", t=300)
run("npm install -g pm2 2>&1 || true", t=120)
run("pm2 stop scheduling-backend 2>/dev/null; pm2 delete scheduling-backend 2>/dev/null; true")
run("cd /root/scheduling-backend && pm2 start server.js --name scheduling-backend 2>&1")
run("pm2 save 2>&1")
time.sleep(3)
run("pm2 status 2>&1")
run("curl -s http://localhost:3001/api/health 2>&1")
ssh.close()
print("完成")
