import paramiko
import json

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

print("=== Verify deployed fixes ===")

print("\n1. Auth middleware - host token support:")
run("grep -n 'role.*host\\|hostToken\\|GEWU_CLOUD_RELAY_HOST_TOKEN' /root/education-platform/gateway/src/websocket/authMiddleware.js")

print("\n2. Server.js - ping handler:")
run("grep -n 'case.*ping\\|pong' /root/education-platform/gateway/src/websocket/server.js")

print("\n3. Server.js - payload field:")
run("grep -n 'payload:' /root/education-platform/gateway/src/websocket/server.js")

print("\n4. CloudRelay.js - targetDeviceId:")
run("grep -n 'targetDeviceId' /root/education-platform/gateway/src/routes/cloudRelay.js")

print("\n5. Shared logic deployed:")
run("ls -la /root/education-platform/shared/")

print("\n6. Gateway health:")
run("curl -s http://localhost:3001/api/health")

print("\n7. WebSocket server log:")
run("pm2 logs gateway --lines 5 --nostream 2>/dev/null | grep -i websocket")

print("\n8. Test WS connection (auth rejection expected):")
run("node -e \"const WebSocket=require('ws');const ws=new WebSocket('ws://localhost:3001/ws/cloud-relay?token=test&deviceId=test&role=host');ws.on('error',e=>{console.log('Error (expected):',e.message);process.exit(0)});ws.on('open',()=>{console.log('Connected!');ws.close();process.exit(0)});setTimeout(()=>{console.log('Timeout');process.exit(1)},5000)\"")

print("\n9. Backend status:")
run("curl -s http://localhost:3000/api/health")

ssh.close()
print("\nAll checks done!")
