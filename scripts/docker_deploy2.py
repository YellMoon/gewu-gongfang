import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run(cmd, t=30):
    i, o, e = ssh.exec_command(cmd, timeout=t)
    out = o.read().decode('utf-8', errors='replace')[:2000]
    return out

# 1. 后台构建
print("=== 后台构建 Docker 镜像 ===")
run("cd /root/scheduling-backend && nohup docker build -t scheduling-api:latest . > /tmp/docker-build.log 2>&1 &")
time.sleep(2)

# 2. 等待构建完成（每 10 秒检查一次，最多等 10 分钟）
for i in range(60):
    time.sleep(10)
    out = run("tail -3 /tmp/docker-build.log 2>/dev/null")
    print(f"[{(i+1)*10}s] {out.strip()[-80:]}")
    # 检查进程是否还在
    ps = run("pgrep -f 'docker build' || echo done")
    if 'done' in ps:
        print("构建完成!")
        break

# 3. 查看完整日志最后 10 行
out = run("tail -10 /tmp/docker-build.log")
print(f"\n=== 构建结果 ===\n{out}")

# 4. 检查镜像是否存在
out = run("docker images scheduling-api --format '{{.Repository}}:{{.Tag}} {{.Size}}'")
print(f"镜像: {out}")

# 5. 启动容器
print("\n=== 启动容器 ===")
run("docker rm -f scheduling-backend 2>/dev/null || true")
run("docker run -d --name scheduling-backend --network app_default --restart unless-stopped -v scheduling_data:/app/data scheduling-api:latest")
time.sleep(3)

# 6. 验证
out = run("docker ps --filter name=scheduling-backend --format '{{.Names}} {{.Status}}'")
print(f"容器: {out}")

# 7. 测试内网
out = run("docker exec scheduling-backend curl -s http://localhost:3001/api/health 2>&1 || true")
print(f"健康检查: {out.strip()}")

# 8. 配置 Nginx
print("\n=== 配置 Nginx ===")
nginx_conf = r"""events {
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
    f.write(nginx_conf)

run("docker cp /tmp/scheduling-nginx.conf nginx:/etc/nginx/conf.d/default.conf")
out = run("docker exec nginx nginx -t 2>&1")
print(f"Nginx 检查: {out.strip()}")
run("docker exec nginx nginx -s reload 2>&1")
print("Nginx 已重载")

# 9. 最终验证
out = run("curl -s http://localhost:3001/api/health 2>&1 || true")
print(f"\n本机测试: {out.strip()}")

ssh.close()
print("\n=== 部署完成 ===")
