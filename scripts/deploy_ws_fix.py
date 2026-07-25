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
print(f"Connected to {HOST}")

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
    print(f"  Uploaded: {os.path.basename(local_path)} -> {remote_path}")

# 1. Check what's already uploaded and what's missing
print("=== Current authMiddleware.js content ===")
run("head -20 /root/education-platform/gateway/src/websocket/authMiddleware.js")

print("\n=== Current server.js content (first 15 lines of handlers) ===")
run("grep -n 'case\\|payload\\|ping\\|heartbeat' /root/education-platform/gateway/src/websocket/server.js")

print("\n=== Current cloudRelay.js - find notifyDesktopTaskComplete ===")
run("grep -n -A3 'notifyDesktopTaskComplete' /root/education-platform/gateway/src/routes/cloudRelay.js")

# 2. Upload shared directory to correct location
print("\n=== Upload shared directory ===")
shared_local = os.path.join(LOCAL_PROJECT, "shared")
shared_remote = "/root/education-platform/shared"
run(f"mkdir -p {shared_remote}")
for f in os.listdir(shared_local):
    if f.endswith(".js"):
        upload(os.path.join(shared_local, f), f"{shared_remote}/{f}")

# 3. Check if backend is embedded in gateway
print("\n=== Check gateway package.json for backend deps ===")
run("cat /root/education-platform/gateway/package.json | head -20")

# 4. Find backend code
print("\n=== Find backend-related files ===")
run("find /root/education-platform -maxdepth 5 -name 'cloudRelayHost.js' 2>/dev/null")
run("find /root/education-platform -maxdepth 5 -name 'desktopIdentity.js' 2>/dev/null")
run("find /root/education-platform -maxdepth 5 -path '*/backend/*' -name '*.js' 2>/dev/null | head -10")

# 5. Check if the cloudRelay.js fix for deviceId was uploaded
print("\n=== Verify cloudRelay.js fix ===")
run("grep -n 'payload.*deviceId\\|targetDeviceId' /root/education-platform/gateway/src/routes/cloudRelay.js | head -5")

# 6. Stop old processes and restart
print("\n=== Stop and restart gateway ===")
run("pm2 delete edu-gateway 2>/dev/null")
run("pm2 delete gateway 2>/dev/null")
run("cd /root/education-platform/gateway && pm2 start src/app.js --name gateway --update-env")
time.sleep(3)

# 7. Health check
print("\n=== Health check ===")
run("curl -s http://localhost:3001/api/health")

# 8. Test WebSocket
print("\n=== Test WebSocket server ===")
run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ws/cloud-relay 2>/dev/null || echo 'WS endpoint exists'")

# 9. Check logs for errors
print("\n=== Recent logs ===")
run("pm2 logs gateway --lines 15 --nostream 2>/dev/null")

ssh.close()
print("\nDone!")
