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
    return stdout.channel.recv_exit_status()

print("=== PM2 进程列表 ===")
run("pm2 list")

print("\n=== 端口占用 ===")
run("ss -tlnp | grep -E '3000|3001'")

print("\n=== Gateway 配置 ===")
run("cat /root/education-platform/gateway/package.json | grep -E 'name|version|main'")

print("\n=== Backend 配置 ===")
run("pm2 show scheduling-backend-prod 2>/dev/null | grep -E 'name|script|exec cwd|exec mode'")

print("\n=== Gateway 环境变量（关键项）===")
run("pm2 env 40 2>/dev/null | grep -E 'PORT|HOST|BACKEND|JWT|GEWU' | head -10")

print("\n=== Backend 环境变量（关键项）===")
run("pm2 env 38 2>/dev/null | grep -E 'PORT|HOST|GATEWAY|JWT|GEWU' | head -10")

print("\n=== Gateway 日志（最近）===")
run("pm2 logs gateway --lines 5 --nostream 2>/dev/null")

print("\n=== Backend 日志（最近）===")
run("pm2 logs scheduling-backend-prod --lines 5 --nostream 2>/dev/null")

ssh.close()
