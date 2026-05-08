import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd):
    i, o, e = ssh.exec_command(cmd, timeout=15)
    print(o.read().decode('utf-8', errors='replace')[:2000])
    er = e.read().decode('utf-8', errors='replace')
    if er.strip(): print("ERR:", er[:500])

run("cat /etc/nginx/sites-enabled/default 2>/dev/null || cat /etc/nginx/conf.d/*.conf 2>/dev/null || nginx -T 2>/dev/null | head -100")
run("ls /etc/nginx/sites-enabled/ 2>/dev/null")
run("cat /etc/nginx/nginx.conf 2>/dev/null | head -50")
ssh.close()
