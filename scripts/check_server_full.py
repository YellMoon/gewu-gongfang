import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd):
    i, o, e = ssh.exec_command(cmd, timeout=15)
    out = o.read().decode('utf-8', errors='replace')[:3000]
    err = e.read().decode('utf-8', errors='replace')[:500]
    print(out)
    if err.strip(): print("ERR:", err)

run("ls /etc/nginx/sites-enabled/ 2>/dev/null")
run("ls /etc/nginx/sites-available/ 2>/dev/null")
run("ls /etc/letsencrypt/live/ 2>/dev/null || echo 'no letsencrypt'")
run("which certbot 2>/dev/null || echo 'no certbot'")
run("ss -tlnp | grep -E '80|443|3001'")
run("ps aux | grep -E 'node|python|fastapi|uvicorn|gunicorn' | grep -v grep")
ssh.close()
