import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=15):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', errors='replace').strip()

# 1. Nginx 重载
run("docker exec nginx nginx -s reload 2>&1")

# 2. 测试 Nginx 代理（容器内用 Host 头）
r1 = run("docker exec nginx curl -s -k -H 'Host: physicsedu.xyz' http://127.0.0.1/scheduling/api/health 2>&1")
print(f"HTTP 内部: {r1}")

# 3. 外网测试
r2 = run("curl -sk https://physicsedu.xyz/scheduling/api/health 2>&1", t=15)
print(f"HTTPS 外网: {r2}")

# 4. 检查 Nginx 有没有 scheduling location
r3 = run("docker exec nginx grep -c scheduling /etc/nginx/conf.d/default.conf")
print(f"scheduling 出现次数: {r3}")

# 5. 检查 docker gateway
r4 = run("docker network inspect app_default --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'")
print(f"网关: {r4}")

ssh.close()
