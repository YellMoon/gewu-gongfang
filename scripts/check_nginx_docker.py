import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd):
    i, o, e = ssh.exec_command(cmd, timeout=20)
    out = o.read().decode('utf-8', errors='replace')[:3000]
    print(out)

run("docker exec nginx cat /etc/nginx/nginx.conf 2>/dev/null")
run("docker exec nginx ls /etc/nginx/conf.d/ 2>/dev/null")
run("docker exec nginx cat /etc/nginx/conf.d/default.conf 2>/dev/null || docker exec nginx cat /etc/nginx/sites-enabled/default 2>/dev/null")
run("cat /root/scheduling-backend/Dockerfile 2>/dev/null")
ssh.close()
