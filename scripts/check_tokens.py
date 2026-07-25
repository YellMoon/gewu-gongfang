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

print("=== Backend 环境变量 ===")
run("pm2 env 38 2>/dev/null | grep -E 'GEWU_CLOUD_RELAY|JWT_SECRET|PORT|HOST'")

print("\n=== Gateway 环境变量 ===")
run("pm2 env 40 2>/dev/null | grep -E 'GEWU_CLOUD_RELAY|JWT_SECRET|PORT|HOST'")

print("\n=== Gateway .env 文件 ===")
run("cat /root/education-platform/gateway/.env 2>/dev/null || echo 'no .env'")
run("cat /root/education-platform/gateway/.env.production 2>/dev/null || echo 'no .env.production'")

print("\n=== Backend .env 文件 ===")
run("cat /root/scheduling-backend/.env 2>/dev/null || echo 'no .env'")
run("cat /root/scheduling-backend/.env.production 2>/dev/null || echo 'no .env.production'")

print("\n=== Gateway authMiddleware 关键代码 ===")
run("grep -n 'hostToken\\|GEWU_CLOUD_RELAY' /root/education-platform/gateway/src/websocket/authMiddleware.js")

print("\n=== Gateway cloudRelay requireHostToken ===")
run("grep -n -A5 'requireHostToken' /root/education-platform/gateway/src/routes/cloudRelay.js | head -15")

print("\n=== Backend server.js WebSocket 连接代码 ===")
run("cat /root/scheduling-backend/server.js 2>/dev/null | head -30")

print("\n=== Backend websocket client.js ===")
run("cat /root/scheduling-backend/src/websocket/client.js 2>/dev/null | head -40")

ssh.close()
