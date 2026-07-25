import paramiko
import json
import time

HOST = "39.106.172.132"
USER = "root"
PASS = "***REMOVED_CREDENTIAL***"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=10)
print(f"Connected to {HOST}\n")

def run(cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out.strip(), err.strip()

results = []

def test(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    results.append((name, passed, detail))
    print(f"  [{status}] {name}" + (f" ({detail})" if detail else ""))

print("=" * 60)
print("全链路测试：桌面端 ↔ Gateway ↔ 数据主机")
print("=" * 60)

# 阶段一：基础设施
print("\n--- 阶段一：基础设施 ---")

out, err = run("curl -s http://localhost:3001/api/health")
try:
    data = json.loads(out)
    test("Gateway 健康", data.get("ok") == True, f"version={data.get('version')}")
except:
    test("Gateway 健康", False, out[:100])

out, err = run("curl -s http://localhost:3002/api/health")
try:
    data = json.loads(out)
    test("Backend 健康", data.get("ok") == True, f"version={data.get('version')}")
except:
    test("Backend 健康", False, out[:100])

# 阶段二：WebSocket 服务器
print("\n--- 阶段二：WebSocket 服务器 ---")

out, err = run("grep -c 'WebSocket服务器已启动' /root/.pm2/logs/gateway-out.log 2>/dev/null || echo 0")
test("WS 服务器日志", int(out) > 0)

# 阶段三：主机心跳
print("\n--- 阶段三：主机心跳 ---")

out, err = run('''curl -s -X POST http://localhost:3001/api/cloud/host/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"hostDeviceId":"test-host","lanUrls":[]}' ''')
try:
    data = json.loads(out)
    test("主机心跳", data.get("success") == True or "token" in str(data).lower(), str(data)[:80])
except:
    test("主机心跳", False, out[:100])

# 阶段四：配对能力查询
print("\n--- 阶段四：配对能力 ---")

out, err = run("curl -s http://localhost:3001/api/cloud/desktop-pairing/capability")
try:
    data = json.loads(out)
    test("配对能力查询", "success" in data, str(data)[:80])
except:
    test("配对能力查询", False, out[:100])

# 阶段五：设备注册
print("\n--- 阶段五：设备注册 ---")

out, err = run('''curl -s -X POST http://localhost:3001/api/cloud/desktop-sync/devices/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-desktop-123"}' ''')
try:
    data = json.loads(out)
    test("设备注册", data.get("success") == True, str(data)[:80])
except:
    test("设备注册", False, out[:100])

# 阶段六：V1 配对端点已移除
print("\n--- 阶段六：安全检查 ---")

out, err = run('''curl -s -w "\\n%{http_code}" -X POST http://localhost:3001/api/desktop-pairing/start \
  -H "Content-Type: application/json" -d '{}' ''')
code = out.split('\n')[-1] if '\n' in out else out
test("V1 配对返回 410", code == "410", f"code={code}")

out, err = run("curl -s -w '\\n%{http_code}' http://localhost:3001/api/cloud/tasks?status=pending_host")
code = out.split('\n')[-1] if '\n' in out else out
test("无 token 访问拒绝", code in ["401", "403"], f"code={code}")

# 阶段七：WebSocket 连接测试
print("\n--- 阶段七：WebSocket 连接 ---")

# 用 node 测试（需要在 gateway 目录下运行以找到 ws 模块）
out, err = run('''cd /root/education-platform/gateway && node -e "
const WebSocket = require('ws');

// 测试 1: 无效 token 应被拒绝
const ws1 = new WebSocket('ws://localhost:3001/ws/cloud-relay?token=invalid&deviceId=test&role=host');
ws1.on('error', (e) => {
  console.log('AUTH_REJECTED');
  process.exit(0);
});
ws1.on('open', () => { 
  console.log('UNEXPECTED_CONNECT'); 
  ws1.close(); 
  process.exit(1); 
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);
"''', timeout=10)
test("WS 无效 token 拒绝", "AUTH_REJECTED" in out, out[:50])

# 阶段八：任务创建和认领
print("\n--- 阶段八：任务流程 ---")

out, err = run('''curl -s -X POST http://localhost:3001/api/cloud/tasks \
  -H "Content-Type: application/json" \
  -H "x-gewu-host-token: 2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec" \
  -d '{"taskType":"desktop-sync","payload":{"deviceId":"test","pendingChanges":[]}}' ''')
try:
    data = json.loads(out)
    task_id = data.get("task", {}).get("id") or data.get("id")
    test("任务创建", data.get("success") == True or task_id, f"taskId={task_id}")
except:
    test("任务创建", False, out[:100])

if task_id:
    out, err = run(f'''curl -s -X POST http://localhost:3001/api/cloud/tasks/claim \
      -H "Content-Type: application/json" \
      -d '{{"hostDeviceId":"test-host","leaseMs":60000}}' ''')
    try:
        data = json.loads(out)
        test("任务认领", data.get("success") == True, str(data)[:80])
    except:
        test("任务认领", False, out[:100])

# 阶段九：后端 WebSocket 客户端
print("\n--- 阶段九：Backend WS 客户端 ---")

out, err = run("grep -c 'HostWS.*连接成功\\|HostWS.*已连接' /root/.pm2/logs/scheduling-backend-prod-out.log 2>/dev/null || echo 0")
ws_connected = int(out) > 0
test("Backend WS 连接", ws_connected, f"连接次数={out}")

out, err = run("grep -c 'HostWS.*连接错误\\|HostWS.*认证失败' /root/.pm2/logs/scheduling-backend-prod-error.log 2>/dev/null || echo 0")
ws_errors = int(out)
test("Backend WS 无认证错误", ws_errors == 0, f"错误次数={ws_errors}")

# 汇总
print("\n" + "=" * 60)
print("测试结果汇总")
print("=" * 60)

passed = sum(1 for _, p, _ in results if p)
failed = sum(1 for _, p, _ in results if not p)
total = len(results)

for name, p, d in results:
    status = "PASS" if p else "FAIL"
    print(f"  [{status}] {name}" + (f" ({d})" if d else ""))

print(f"\n总计: {passed}/{total} 通过, {failed} 失败")

if failed == 0:
    print("\nALL PASSED - 全链路正常！")
else:
    print(f"\n{failed} 个测试需要关注")

ssh.close()
