import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=15):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', errors='replace').strip()

# 1. 检查 nginx 容器所在网络
print("=== nginx 网络 ===")
print(run("docker inspect nginx --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}: {{$v.IPAddress}}{{end}}'"))

# 2. 检查 nginx 是否有挂载的其他配置
print("\n=== nginx 挂载 ===")
print(run("docker inspect nginx --format '{{json .Mounts}}' 2>&1 | python3 -m json.tool 2>/dev/null || docker inspect nginx --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'"))

# 3. 检查 nginx 主配置是否有 include 覆盖
print("\n=== nginx 主配置 ===")
print(run("docker exec nginx cat /etc/nginx/nginx.conf | grep -v '^#' | grep -v '^$'", t=10))

# 4. 关键测试：从本地 curl 不同路径
print("\n=== 路径测试 ===")
print("scheduling:", run("docker exec nginx curl -s -o /dev/null -w '%{http_code} %{upstream_addr}' -H 'Host: physicsedu.xyz' http://127.0.0.1/scheduling/api/health"))
print("api:", run("docker exec nginx curl -s -o /dev/null -w '%{http_code} %{upstream_addr}' -H 'Host: physicsedu.xyz' http://127.0.0.1/api/students"))

ssh.close()
