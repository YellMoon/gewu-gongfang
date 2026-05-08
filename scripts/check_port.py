import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    print(stdout.read().decode('utf-8', errors='replace')[:500])
    e = stderr.read().decode('utf-8', errors='replace')
    if e.strip(): print("ERR:", e[:300])

run("ss -tlnp | grep 3001")
run("curl -s http://127.0.0.1:3001/api/health")
run("curl -s http://localhost:3001/api/health")
run("ufw status 2>/dev/null || echo 'ufw not active'")
# 尝试用公网 IP 测试
run("curl -s http://39.106.172.132:3001/api/health 2>&1 || echo 'bind check done'")
ssh.close()
