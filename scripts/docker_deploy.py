import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=60):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', errors='replace')[:3000]
    err = e.read().decode('utf-8', errors='replace')[:500]
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:300])

# 1. 构建 Docker 镜像
print("=== 构建调度系统 Docker 镜像 ===")
run("cd /root/scheduling-backend && docker build -t scheduling-api:latest . 2>&1", t=120)

# 2. 启动容器
print("\n=== 启动容器 ===")
run("docker rm -f scheduling-backend 2>/dev/null || true")
run("docker run -d --name scheduling-backend --network app_default --restart unless-stopped -v sqlite_data:/app/data scheduling-api:latest 2>&1")

time.sleep(3)
print("\n=== 验证容器 ===")
run("docker ps --filter name=scheduling-backend --format '{{.Names}} {{.Status}} {{.Ports}}'")

# 3. 测试内部连通
print("\n=== 测试连通性 ===")
run('docker exec scheduling-backend node -e "require(\'http\').get(\'http://localhost:3001/api/health\', r => { let d=\'\'; r.on(\'data\',c=>d+=c); r.on(\'end\',()=>console.log(d)) })" 2>&1')

# 4. 修改 Nginx 配置
print("\n=== 修改 Nginx 配置 ===")
# 复制现有配置
run("docker cp nginx:/etc/nginx/conf.d/default.conf /tmp/scheduling-nginx.conf")
# 在 https server block 中添加 /scheduling/ 反代
conf = """events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;

    server {
        listen 80;
        server_name physicsedu.xyz www.physicsedu.xyz;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name physicsedu.xyz www.physicsedu.xyz;

        ssl_certificate     /etc/nginx/ssl/live/physicsedu.xyz/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/live/physicsedu.xyz/privkey.pem;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         HIGH:!aNULL:!MD5;

        # 教务管理系统调度后端
        location /scheduling/ {
            proxy_pass http://scheduling-backend:3001/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /api/ {
            proxy_pass http://backend:8000/api/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /docs {
            proxy_pass http://backend:8000/docs;
        }

        location /openapi.json {
            proxy_pass http://backend:8000/openapi.json;
        }

        location /health {
            proxy_pass http://backend:8000/health;
        }

        location / {
            proxy_pass http://backend:8000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
"""
with open('/tmp/scheduling-nginx.conf', 'w', encoding='utf-8') as f:
    f.write(conf)

# 上传并重启 nginx
run("docker cp /tmp/scheduling-nginx.conf nginx:/etc/nginx/conf.d/default.conf")
run("docker exec nginx nginx -t 2>&1")
run("docker exec nginx nginx -s reload 2>&1")

ssh.close()
print("\n=== 全部完成 ===")
