import paramiko
import time

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

print("=== 最终验证 ===")

print("\n1. PM2 进程状态:")
run("pm2 list")

print("\n2. Gateway 健康:")
run("curl -s http://localhost:3001/api/health")

print("\n3. Backend 健康:")
run("curl -s http://localhost:3002/api/health")

print("\n4. Backend WebSocket 连接状态:")
run("pm2 logs scheduling-backend-prod --lines 20 --nostream 2>/dev/null | grep -i 'HostWS\\|websocket'")

print("\n5. Gateway WebSocket 日志:")
run("pm2 logs gateway --lines 10 --nostream 2>/dev/null | grep -i 'websocket\\|connected'")

print("\n6. 端口监听:")
run("ss -tlnp | grep -E '3001|3002'")

ssh.close()
print("\n验证完成!")
