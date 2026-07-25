import paramiko
import time

HOST = "39.106.172.132"
USER = "root"
PASS = "***REMOVED_CREDENTIAL***"

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

HOST_TOKEN = "2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec"
JWT_SECRET = "9898bbc310e143a28071a41260d85d12a6a64e29d6a845f68a2400b9f91f0fe7"

# 1. 检查 Gateway app.js 是否加载 dotenv
print("=== 检查 Gateway dotenv ===")
run("head -10 /root/education-platform/gateway/src/app.js")

# 2. 用 env vars 直接启动 Gateway
print("\n=== 重启 Gateway (带环境变量) ===")
run("pm2 delete gateway 2>/dev/null")
run(f'cd /root/education-platform/gateway && GEWU_CLOUD_RELAY_HOST_TOKEN={HOST_TOKEN} JWT_SECRET={JWT_SECRET} PORT=3001 pm2 start src/app.js --name gateway')
time.sleep(3)

# 3. 验证环境变量
print("\n=== 验证环境变量 ===")
run("pm2 env 41 2>/dev/null | grep -E 'GEWU_CLOUD_RELAY|JWT_SECRET'")

# 4. 测试心跳
print("\n=== 测试心跳 ===")
run(f'''curl -s -X POST http://localhost:3001/api/cloud/host/heartbeat \
  -H "Content-Type: application/json" \
  -H "x-gewu-host-token: {HOST_TOKEN}" \
  -d '{{"hostDeviceId":"primary-host","lanUrls":[]}}' ''')

# 5. 测试 WS
print("\n=== 测试 WebSocket ===")
run(f'''cd /root/education-platform/gateway && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token={HOST_TOKEN}&deviceId=primary-host&role=host');
ws.on('message', (d) => {{ const m=JSON.parse(d); console.log('MSG:'+m.type); if(m.type==='connected'){{ws.close();process.exit(0)}} }});
ws.on('error', (e) => {{ console.log('ERROR:'+e.message); process.exit(1); }});
setTimeout(() => {{ console.log('TIMEOUT'); process.exit(1); }}, 5000);
"''', timeout=10)

# 6. Backend WS 日志
print("\n=== Backend 日志 ===")
run("pm2 logs scheduling-backend-prod --lines 10 --nostream 2>/dev/null | grep -i ws")

ssh.close()
print("\nDone!")
