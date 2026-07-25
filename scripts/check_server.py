import paramiko
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

# Find actual paths
print("=== Gateway websocket ===")
run("ls -la /root/education-platform/gateway/src/websocket/")

print("\n=== Backend directory ===")
run("find /root/education-platform -maxdepth 4 -type d -name 'backend' 2>/dev/null")
run("find /root/education-platform -maxdepth 5 -name 'client.js' -path '*/websocket/*' 2>/dev/null")

print("\n=== Shared directory ===")
run("ls -la /root/education-platform/gateway/shared/")

print("\n=== Desktop services ===")
run("find /root/education-platform -maxdepth 4 -name 'websocketClient.mjs' 2>/dev/null")
run("find /root/education-platform -maxdepth 4 -name 'desktopSessionRelayClient.mjs' 2>/dev/null")

print("\n=== Root structure ===")
run("ls -la /root/education-platform/")

ssh.close()
