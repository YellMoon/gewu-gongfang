#!/usr/bin/env python3
"""SSH 部署脚本 - 将后端部署到阿里云服务器"""
import paramiko
import sys
import time

HOST = "39.106.172.132"
PORT = 22
USER = "root"
PASSWORD = "***REMOVED_CREDENTIAL***"

def run(ssh, cmd, timeout=30):
    """执行命令并输出"""
    print(f">>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out.strip():
        print(out)
    if err.strip():
        print(f"STDERR: {err}")
    return out, err

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"连接 {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=10)
    print("连接成功\n")
    
    if mode == "check":
        # 检查环境
        run(ssh, "node -v")
        run(ssh, "npm -v")
        run(ssh, "ls /root/")
        run(ssh, "which pm2 || echo 'pm2 not installed'")
        run(ssh, "ufw status 2>/dev/null || iptables -L INPUT -n 2>/dev/null | head -20")
        
    elif mode == "deploy":
        # 检查 Node.js，没装则安装
        out, _ = run(ssh, "node -v")
        if 'command not found' in out or not out.strip():
            run(ssh, "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -", timeout=60)
            run(ssh, "apt-get install -y nodejs", timeout=120)
            run(ssh, "node -v")
            run(ssh, "npm -v")
        else:
            print(f"Node 已安装: {out.strip()}")
        
        # 部署后端
        run(ssh, "mkdir -p /root/scheduling-backend")
        
        # 传输文件
        sftp = ssh.open_sftp()
        local_dir = r"C:\Users\83423\.openclaw\workspace\scheduling-system\backend"
        
        import os
        for root, dirs, files in os.walk(local_dir):
            if 'node_modules' in root:
                continue
            for f in files:
                if f.endswith('.db'):
                    continue
                local_path = os.path.join(root, f)
                rel_path = os.path.relpath(local_path, local_dir).replace('\\', '/').replace('\\', '/')
                remote_path = '/root/scheduling-backend/' + rel_path
                remote_dir = '/root/scheduling-backend/' + os.path.dirname(rel_path)
                run(ssh, f"mkdir -p {remote_dir}")
                sftp.put(local_path, remote_path)
                print(f"  OK: {rel_path}")
        sftp.close()
        
        # 安装依赖
        run(ssh, "cd /root/scheduling-backend && npm install --production 2>&1", timeout=300)
        
        # 安装 pm2
        run(ssh, "npm install -g pm2 2>/dev/null || echo 'pm2 install skipped'")
        
        # 停止旧进程
        run(ssh, "pm2 stop scheduling-backend 2>/dev/null || true")
        run(ssh, "pm2 delete scheduling-backend 2>/dev/null || true")
        
        # 启动新进程
        run(ssh, "cd /root/scheduling-backend && pm2 start server.js --name scheduling-backend", timeout=30)
        run(ssh, "pm2 save")
        
        # 验证
        time.sleep(2)
        run(ssh, "pm2 status")
        run(ssh, "curl -s http://localhost:3001/api/health || echo 'health check failed'")
        
    elif mode == "status":
        run(ssh, "pm2 status")
        run(ssh, "curl -s http://localhost:3001/api/health")
        
    ssh.close()
    print("\n完成")

if __name__ == "__main__":
    main()
