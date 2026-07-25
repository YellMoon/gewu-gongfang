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
    return stdout.channel.recv_exit_status()

HOST_TOKEN = "2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec"

# 1. 检查 Gateway 进程的环境变量
print("=== Gateway 环境变量 ===")
run("cat /proc/$(pm2 pid gateway)/environ 2>/dev/null | tr '\\0' '\\n' | grep GEWU")

# 2. Gateway authMiddleware 读取 token 的方式
print("\n=== authMiddleware.js 内容 ===")
run("cat /root/education-platform/gateway/src/websocket/authMiddleware.js")

# 3. 测试 HTTP 心跳 vs WS 认证
print("\n=== HTTP 心跳测试 ===")
run(f'''curl -s -X POST http://localhost:3001/api/cloud/host/heartbeat \
  -H "Content-Type: application/json" \
  -H "x-gewu-host-token: {HOST_TOKEN}" \
  -d '{{"hostDeviceId":"primary-host","lanUrls":[]}}' ''')

# 4. 直接测试 WS 升级
print("\n=== WS 升级测试 ===")
run(f'''cd /root/education-platform/gateway && node -e "
const http = require('http');
const url = 'http://localhost:3001/ws/cloud-relay?token={HOST_TOKEN}&deviceId=primary-host&role=host';
const req = http.get(url, (res) => {{
  console.log('HTTP Status:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers));
  res.on('data', (d) => process.stdout.write(d));
  res.on('end', () => process.exit(0));
}});
req.on('error', (e) => {{ console.log('Error:', e.message); process.exit(1); }});
setTimeout(() => process.exit(0), 3000);
"''', timeout=10)

# 5. 检查 Gateway 日志
print("\n=== Gateway 日志 ===")
run("pm2 logs gateway --lines 10 --nostream 2>/dev/null")

# 6. 修复 Backend
print("\n=== 修复 Backend ===")
run("pm2 logs scheduling-backend-prod --lines 5 --nostream 2>/dev/null | grep -i error")

ssh.close()
