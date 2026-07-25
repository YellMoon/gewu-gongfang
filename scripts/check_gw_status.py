import paramiko

HOST = "39.106.172.132"
USER = "root"
PASS = "***REMOVED_CREDENTIAL***"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"STDERR: {err.strip()}")

print("=== Gateway 状态 ===")
run("pm2 list")
print("\n=== Gateway 健康检查（本地）===")
run("curl -s http://localhost:3001/api/health")
print("\n=== Gateway 最近日志 ===")
run("pm2 logs gateway --lines 10 --nostream 2>/dev/null")
print("\n=== 端口监听 ===")
run("ss -tlnp | grep 3001")

ssh.close()
