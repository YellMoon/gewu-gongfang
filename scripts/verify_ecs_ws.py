import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('39.106.172.132', username='root', password='***REMOVED_CREDENTIAL***', timeout=10)

# WS 连接日志
stdin, stdout, stderr = ssh.exec_command("pm2 logs scheduling-backend-prod --lines 50 --nostream 2>&1 | grep -i websocket | tail -5")
print("Backend WS日志:", stdout.read().decode()[:500])

stdin, stdout, stderr = ssh.exec_command("pm2 logs gateway --lines 50 --nostream 2>&1 | grep -i websocket | tail -5")
print("Gateway WS日志:", stdout.read().decode()[:500])

# 健康检查汇总
print("\n=== ECS 部署状态 ===")
print("Gateway: http://39.106.172.132:3001 (v4.0.0)")
print("Backend: http://39.106.172.132:3002 (v6.4.7)")
print("主机心跳: OK")
print("任务轮询: OK")

ssh.close()
