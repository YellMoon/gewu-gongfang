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

print("=== 检查 nginx ===")
run("which nginx 2>/dev/null && nginx -t 2>&1 || echo 'nginx not found'")

print("\n=== 检查 80/443 端口 ===")
run("ss -tlnp | grep -E ':80 |:443 '")

print("\n=== 检查 ECS 安全组（iptables）===")
run("iptables -L INPUT -n 2>/dev/null | head -20 || echo 'no iptables access'")

print("\n=== 检查 3001 端口是否对外监听 ===")
run("ss -tlnp | grep 3001")

print("\n=== 从外部测试 HTTP ===")
run("curl -s -o /dev/null -w '%{http_code}' http://39.106.172.132:3001/api/health 2>/dev/null || echo 'curl failed'")

ssh.close()
