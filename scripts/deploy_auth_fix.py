import paramiko
import time
import os

HOST = "39.106.172.132"
USER = "root"
PASS = "***REMOVED_CREDENTIAL***"
LOCAL_PROJECT = r"C:\Users\83423\.openclaw\workspace\scheduling-system"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=10)

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"STDERR: {err.strip()}")
    return stdout.channel.recv_exit_status()

def upload(local_path, remote_path):
    sftp = ssh.open_sftp()
    sftp.put(local_path, remote_path)
    sftp.close()
    print(f"  Uploaded: {os.path.basename(local_path)}")

HOST_TOKEN = "2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec"

# 1. 上传修复后的 authMiddleware.js
print("=== 上传 authMiddleware.js ===")
upload(
    os.path.join(LOCAL_PROJECT, "gateway", "src", "websocket", "authMiddleware.js"),
    "/root/education-platform/gateway/src/websocket/authMiddleware.js"
)

# 2. 重启 Gateway
print("\n=== 重启 Gateway ===")
run("pm2 delete gateway 2>/dev/null")
run(f'cd /root/education-platform/gateway && GEWU_CLOUD_RELAY_HOST_TOKEN={HOST_TOKEN} pm2 start src/app.js --name gateway')
time.sleep(3)

# 3. 健康检查
print("\n=== 健康检查 ===")
run("curl -s http://localhost:3001/api/health")

# 4. 测试 WebSocket
print("\n=== 测试 WebSocket 认证 ===")
run(f'''cd /root/education-platform/gateway && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token={HOST_TOKEN}&deviceId=primary-host&role=host');
ws.on('message', (d) => {{
  const m = JSON.parse(d);
  console.log('MSG:' + m.type);
  if (m.type === 'connected') {{ ws.close(); process.exit(0); }}
}});
ws.on('error', (e) => {{ console.log('ERROR:' + e.message); process.exit(1); }});
setTimeout(() => {{ console.log('TIMEOUT'); process.exit(1); }}, 5000);
"''', timeout=10)

# 5. 重启 Backend 并检查 WS 日志
print("\n=== 重启 Backend ===")
run("pm2 restart scheduling-backend-prod")
time.sleep(5)

print("\n=== Backend WebSocket 日志 ===")
run("pm2 logs scheduling-backend-prod --lines 15 --nostream 2>/dev/null | grep -i 'ws\\|websocket\\|HostWS'")

ssh.close()
print("\nDone!")
