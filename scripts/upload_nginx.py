import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)
print("已连接")

def run(cmd, t=15):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', errors='replace')[:1500]
    err = e.read().decode('utf-8', errors='replace')[:500]
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:200])

# 上传 Nginx 配置
sftp = ssh.open_sftp()
sftp.put(r"C:\Users\83423\.openclaw\workspace\scheduling-system\scripts\nginx-scheduling.conf", "/tmp/scheduling-nginx.conf")
sftp.close()
print("配置已上传")

# 复制到容器
run("docker cp /tmp/scheduling-nginx.conf nginx:/etc/nginx/conf.d/default.conf")

# 测试配置
run("docker exec nginx nginx -t")

# 重载
run("docker exec nginx nginx -s reload")
print("Nginx 已重载")

# 测试
run("curl -s http://localhost:3001/api/health")
run("docker exec nginx curl -s http://172.18.0.1:3001/api/health")

ssh.close()
print("\n完成")
