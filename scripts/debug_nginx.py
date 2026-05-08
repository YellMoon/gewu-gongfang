import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=10):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', errors='replace').strip()

# 关键测试：用 Nginx debug 看 location 匹配
r1 = run("docker exec nginx curl -sk https://physicsedu.xyz/scheduling/api/health -H 'Host: physicsedu.xyz' -v 2>&1 | head -20")
print("verbose:\n" + r1 + "\n")

# 测试不带 scheduling 前缀，直接访问 3001
r2 = run("docker exec nginx curl -s http://172.18.0.1:3001/api/health 2>&1")
print("直接3001: " + r2)

# 检查调度后端是否有 /scheduling/ 路由
r3 = run("docker exec nginx curl -s http://172.18.0.1:3001/scheduling/api/health 2>&1")
print("/scheduling/api/health: " + r3)

ssh.close()
