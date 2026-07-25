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

print("=== Backend app.js exports ===")
run("grep -n 'module.exports\\|exports\\.' /root/scheduling-backend/src/app.js")

print("\n=== Backend server.js require ===")
run("head -20 /root/scheduling-backend/server.js")

print("\n=== Backend websocket dir ===")
run("ls -la /root/scheduling-backend/src/websocket/ 2>/dev/null || echo 'dir not found'")

print("\n=== Backend websocket client.js ===")
run("head -30 /root/scheduling-backend/src/websocket/client.js 2>/dev/null || echo 'file not found'")

ssh.close()
