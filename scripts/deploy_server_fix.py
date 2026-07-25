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
    sftp.put(local_path, remote_path)
    sftp.close()
    print(f"  Uploaded: {os.path.basename(local_path)}")

# 1. 上传修复后的 server.js
print("=== 上传 server.js ===")
upload(
    os.path.join(LOCAL_PROJECT, "backend", "server.js"),
    "/root/scheduling-backend/server.js"
)

# 2. 重启 Backend
print("\n=== 重启 Backend ===")
run("pm2 restart scheduling-backend-prod")
time.sleep(5)

# 3. 检查日志
print("\n=== Backend 日志 ===")
run("pm2 logs scheduling-backend-prod --lines 15 --nostream 2>/dev/null | grep -i 'ws\\|websocket\\|HostWS\\|error\\|connected'")

# 4. 检查 Backend WS 是否连接到 Gateway
print("\n=== 检查 WS 连接 ===")
run("curl -s http://localhost:3002/api/health")

ssh.close()
print("\nDone!")
