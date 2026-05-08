import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=15):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    return o.read().decode('utf-8', errors='replace').strip()

# 上传配置到宿主机
sftp = ssh.open_sftp()
sftp.put(r"C:\Users\83423\.openclaw\workspace\scheduling-system\scripts\nginx-scheduling.conf", "/app/nginx.conf")
sftp.close()
print("配置已上传到 /app/nginx.conf")

# 测试配置
print("nginx -t:", run("docker exec nginx nginx -t 2>&1"))

# 重载
print("reload:", run("docker exec nginx nginx -s reload 2>&1"))

# 验证配置被读取
print("scheduling 出现:", run("docker exec nginx grep -c scheduling /etc/nginx/nginx.conf"))

# 测试
import time
time.sleep(2)
r = run("curl -sk https://physicsedu.xyz/scheduling/api/health", t=15)
print("外网测试:", r)

ssh.close()
