import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("39.106.172.132", 22, "root", "***REMOVED_CREDENTIAL***", timeout=10)

def run_bg(cmd):
    """后台执行命令，不等待输出"""
    transport = ssh.get_transport()
    channel = transport.open_session()
    channel.exec_command(f"nohup {cmd} > /tmp/docker-build.log 2>&1 &")
    channel.close()

def run_quiet(cmd, t=15):
    """安静执行，不等待"""
    try:
        i, o, e = ssh.exec_command(cmd, timeout=t)
        return o.read().decode('utf-8', errors='replace')[:1000]
    except:
        return ""

# 1. 后台启动 Docker 构建
print("=== 后台启动 Docker 构建 ===")
run_bg("bash -c 'cd /root/scheduling-backend && docker build -t scheduling-api:latest . 2>&1'")
time.sleep(3)

# 2. 轮询构建日志
print("=== 等待构建完成 ===")
for i in range(90):  # 最多等 15 分钟
    time.sleep(10)
    out = run_quiet("tail -3 /tmp/docker-build.log 2>/dev/null")
    status = out.strip().split('\n')[-1][:80] if out.strip() else '...'
    print(f"[{(i+1)*10}s] {status}")
    
    # 检查是否完成
    ps = run_quiet("pgrep -f 'docker build' && echo running || echo done")
    if 'done' in ps:
        # 等几秒让日志写完
        time.sleep(3)
        out = run_quiet("tail -10 /tmp/docker-build.log")
        print(f"\n=== 构建结果 ===\n{out}")
        break

# 3. 检查镜像
out = run_quiet("docker images scheduling-api --format '{{.Repository}}:{{.Tag}} {{.Size}}'")
print(f"镜像: {out.strip()}")

if 'scheduling-api' not in out:
    print("构建失败，查看完整日志:")
    print(run_quiet("cat /tmp/docker-build.log"))
    ssh.close()
    sys.exit(1)

# 4. 停止旧容器，启动新的
print("\n=== 启动容器 ===")
run_quiet("docker rm -f scheduling-backend 2>/dev/null")
out = run_quiet("docker run -d --name scheduling-backend --network app_default --restart unless-stopped -v scheduling_data:/app/data scheduling-api:latest")
print(f"容器: {out.strip()}")

time.sleep(3)
out = run_quiet("docker ps --filter name=scheduling-backend --format '{{.Names}} {{.Status}}'")
print(f"状态: {out.strip()}")

# 5. 测试内网
out = run_quiet("docker exec scheduling-backend curl -s http://localhost:3001/api/health 2>&1")
print(f"健康检查: {out.strip()}")

# 6. 配置 Nginx（添加 /scheduling/ 反代）
print("\n=== 配置 Nginx ===")
nginx_conf = """events {
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

run_quiet("docker cp /tmp/scheduling-nginx.conf nginx:/etc/nginx/conf.d/default.conf")
out = run_quiet("docker exec nginx nginx -t 2>&1")
print(f"Nginx 检查: {out.strip()}")
run_quiet("docker exec nginx nginx -s reload 2>&1")
print("Nginx 已重载")

# 7. 外网测试
print("\n=== 外网测试 ===")
out = run_quiet("curl -sk https://localhost/scheduling/api/health 2>&1")
print(f"Nginx 代理测试: {out.strip()}")

ssh.close()
print("\n=== 全部完成 ===")
print("访问地址: https://physicsedu.xyz/scheduling/api/health")
print("小程序设置页填写: https://physicsedu.xyz/scheduling")
