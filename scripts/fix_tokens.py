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
print(f"Connected to {HOST}\n")

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"STDERR: {err.strip()}")
    return stdout.channel.recv_exit_status()

def upload(local_path, remote_path):
    sftp = ssh.open_sftp()
    remote_dir = os.path.dirname(remote_path).replace('\\', '/')
    run(f"mkdir -p {remote_dir}")
    sftp.put(local_path, remote_path)
    sftp.close()
    print(f"  Uploaded: {os.path.basename(local_path)}")

# 1. 创建 Gateway .env 文件设置 host token
print("=== 1. 创建 Gateway .env ===")
HOST_TOKEN = "2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec"
JWT_SECRET = "9898bbc310e143a28071a41260d85d12a6a64e29d6a845f68a2400b9f91f0fe7"

env_content = f"""GEWU_CLOUD_RELAY_HOST_TOKEN={HOST_TOKEN}
JWT_SECRET={JWT_SECRET}
PORT=3001
"""

sftp = ssh.open_sftp()
with sftp.open("/root/education-platform/gateway/.env", "w") as f:
    f.write(env_content)
sftp.close()
print("  Created .env with host token and JWT secret")

# 2. 上传 Backend WebSocket 客户端代码
print("\n=== 2. 上传 Backend WebSocket 客户端 ===")
backend_ws_dir = "/root/scheduling-backend/src/websocket"
run(f"mkdir -p {backend_ws_dir}")

backend_files = [
    ("backend/src/websocket/client.js", f"{backend_ws_dir}/client.js"),
]

for local_rel, remote_path in backend_files:
    local_path = os.path.join(LOCAL_PROJECT, local_rel.replace("/", "\\"))
    if os.path.exists(local_path):
        upload(local_path, remote_path)
    else:
        print(f"  SKIP (not found): {local_rel}")

# 3. 上传更新后的 Backend server.js（带 WebSocket 客户端）
print("\n=== 3. 上传 Backend server.js ===")
local_server = os.path.join(LOCAL_PROJECT, "backend", "server.js")
if os.path.exists(local_server):
    upload(local_server, "/root/scheduling-backend/server.js")
else:
    print("  SKIP: backend/server.js not found locally")

# 4. 确保 ws 依赖存在
print("\n=== 4. 检查 ws 依赖 ===")
run("cd /root/scheduling-backend && npm ls ws 2>/dev/null || npm install ws")

# 5. 重启 Gateway（带环境变量）
print("\n=== 5. 重启 Gateway ===")
run("pm2 delete gateway 2>/dev/null")
run("cd /root/education-platform/gateway && pm2 start src/app.js --name gateway --update-env")
time.sleep(3)

# 6. 验证 Gateway 环境变量
print("\n=== 6. 验证 Gateway 环境变量 ===")
run("pm2 env 40 2>/dev/null | grep GEWU_CLOUD_RELAY_HOST_TOKEN | head -1")

# 7. 重启 Backend
print("\n=== 7. 重启 Backend ===")
run("pm2 restart scheduling-backend-prod")
time.sleep(3)

# 8. 健康检查
print("\n=== 8. 健康检查 ===")
run("curl -s http://localhost:3001/api/health")
run("curl -s http://localhost:3002/api/health")

# 9. 测试主机心跳
print("\n=== 9. 测试主机心跳 ===")
run(f'''curl -s -X POST http://localhost:3001/api/cloud/host/heartbeat \
  -H "Content-Type: application/json" \
  -H "x-gewu-host-token: {HOST_TOKEN}" \
  -d '{{"hostDeviceId":"primary-host","lanUrls":["http://127.0.0.1:3002"]}}' ''')

# 10. 测试 WebSocket 认证
print("\n=== 10. 测试 WebSocket 认证 ===")
run(f'''cd /root/education-platform/gateway && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token={HOST_TOKEN}&deviceId=primary-host&role=host');
ws.on('message', (data) => {{
  const msg = JSON.parse(data);
  console.log('MSG:' + msg.type);
  if (msg.type === 'connected') {{ ws.close(); process.exit(0); }}
}});
ws.on('error', (e) => {{ console.log('ERROR:' + e.message); process.exit(1); }});
setTimeout(() => {{ console.log('TIMEOUT'); process.exit(1); }}, 5000);
"''', timeout=10)

# 11. 检查 Backend WS 日志
print("\n=== 11. Backend WebSocket 日志 ===")
run("pm2 logs scheduling-backend-prod --lines 10 --nostream 2>/dev/null | grep -i 'websocket\\|HostWS\\|ws'")

ssh.close()
print("\nDone!")
