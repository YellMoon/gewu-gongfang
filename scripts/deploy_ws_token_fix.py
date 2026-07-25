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

def upload(local_path, remote_path):
    sftp = ssh.open_sftp()
    remote_dir = os.path.dirname(remote_path).replace('\\', '/')
    run(f"mkdir -p {remote_dir}")
    sftp.put(local_path, remote_path)
    sftp.close()
    print(f"  Uploaded: {os.path.basename(local_path)}")

HOST_TOKEN = "2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec"

# 1. 上传修复后的文件
print("=== 上传修复文件 ===")
files = [
    ("src/services/oneClickSyncTransports.mjs", "/root/education-platform/src/services/oneClickSyncTransports.mjs"),
    ("src/services/websocketClient.mjs", "/root/education-platform/src/services/websocketClient.mjs"),
]
for local_rel, remote_path in files:
    local_path = os.path.join(LOCAL_PROJECT, local_rel.replace("/", "\\"))
    if os.path.exists(local_path):
        upload(local_path, remote_path)
    else:
        print(f"  SKIP: {local_rel}")

# 2. 提交到 git（如果服务器有 git）
print("\n=== 检查 git ===")
run("cd /root/education-platform && git status 2>/dev/null | head -5 || echo 'not a git repo'")

# 3. 验证修复
print("\n=== 验证修复 ===")
run("grep -n 'connectWs\\|sessionToken.*jwt\\|sessionToken.*authorization' /root/education-platform/src/services/oneClickSyncTransports.mjs | head -5")

# 4. 测试 WebSocket 连接
print("\n=== 测试 WebSocket 连接 ===")
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

# 5. 检查 Backend WS 日志
print("\n=== Backend WebSocket 日志 ===")
run("pm2 logs scheduling-backend-prod --lines 10 --nostream 2>/dev/null | grep -i 'HostWS'")

ssh.close()
print("\nDone!")
