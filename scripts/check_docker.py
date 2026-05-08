import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd):
    i, o, e = ssh.exec_command(cmd, timeout=15)
    out = o.read().decode('utf-8', errors='replace')[:3000]
    print(out)

run("docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'")
run("ls /root/docker* 2>/dev/null || ls /opt/* 2>/dev/null || echo 'no docker dir'")
run("cat /etc/nginx/sites-available/default 2>/dev/null | head -30")
ssh.close()
