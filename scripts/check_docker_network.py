import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd):
    i, o, e = ssh.exec_command(cmd, timeout=15)
    print(o.read().decode('utf-8', errors='replace')[:2000])

# 1. 添加调度系统到 docker-compose
run("cat /root/scheduling-backend/docker-compose.yml")
run("docker network ls")
run("docker inspect nginx --format '{{json .NetworkSettings.Networks}}'")
ssh.close()
