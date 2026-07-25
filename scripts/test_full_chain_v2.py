import paramiko
import json

HOST = "39.106.172.132"
USER = "root"
PASS = "***REMOVED_CREDENTIAL***"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=10)

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
print("全链路测试")
print("=" * 60)

# 阶段一：基础设施
print("\n--- 基础设施 ---")

out, _ = run("curl -s http://localhost:3001/api/health")
try:
    data = json.loads(out)
    test("Gateway 健康", data.get("ok"), f"v{data.get('version')}")
except: test("Gateway 健康", False, out[:80])

out, _ = run("curl -s http://localhost:3002/api/health")
try:
    data = json.loads(out)
    test("Backend 健康", data.get("ok"), f"v{data.get('version')}")
except: test("Backend 健康", False, out[:80])

# 阶段二：Backend WS 连接状态
print("\n--- Backend WebSocket ---")

out, _ = run("grep 'HostWS' /root/.pm2/logs/scheduling-backend-prod-out.log 2>/dev/null | tail -3")
ws_logs = out
test("Backend WS 日志", "HostWS" in ws_logs, ws_logs[:100] if ws_logs else "无日志")

out, _ = run("grep 'HostWS' /root/.pm2/logs/scheduling-backend-prod-error.log 2>/dev/null | tail -3")
ws_err = out
test("Backend WS 无认证错误", "认证失败" not in ws_err and "401" not in ws_err, ws_err[:100] if ws_err else "无错误")

# 阶段三：主机心跳（使用正确的 token）
print("\n--- 主机心跳 ---")

# 从 Backend 环境变量获取真实 token
out, _ = run("pm2 env 38 2>/dev/null | grep GEWU_CLOUD_RELAY_HOST_TOKEN | head -1")
token_line = out
real_token = token_line.split("=")[-1].strip() if "=" in token_line else ""
print(f"  Host token: {real_token[:20]}...")

out, _ = run(f'''curl -s -X POST http://localhost:3001/api/cloud/host/heartbeat \
  -H "Content-Type: application/json" \
  -H "x-gewu-host-token: {real_token}" \
  -d '{{"hostDeviceId":"primary-host","lanUrls":["http://127.0.0.1:3002"]}}' ''')
try:
    data = json.loads(out)
    test("主机心跳(正确token)", data.get("success") == True, str(data)[:80])
except: test("主机心跳", False, out[:80])

# 阶段四：配对能力
print("\n--- 配对能力 ---")

out, _ = run("curl -s http://localhost:3001/api/cloud/desktop-pairing/capability")
try:
    data = json.loads(out)
    test("配对能力查询", "success" in data, str(data)[:80])
except: test("配对能力查询", False, out[:80])

# 阶段五：V1 端点已移除
print("\n--- 安全检查 ---")

out, _ = run('''curl -s -w "\\n%{http_code}" -X POST http://localhost:3001/api/desktop-pairing/start \
  -H "Content-Type: application/json" -d '{}' ''')
code = out.split('\n')[-1] if '\n' in out else out
test("V1 配对返回 410", code == "410", f"code={code}")

out, _ = run("curl -s -w '\\n%{http_code}' http://localhost:3001/api/cloud/tasks?status=pending_host")
code = out.split('\n')[-1] if '\n' in out else out
test("无 token 拒绝", code in ["401", "403"], f"code={code}")

# 阶段六：WebSocket 认证
print("\n--- WebSocket 认证 ---")

out, _ = run('''cd /root/education-platform/gateway && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token=invalid&deviceId=test&role=host');
ws.on('error', (e) => { console.log('REJECTED'); process.exit(0); });
ws.on('open', () => { console.log('SHOULD_NOT_CONNECT'); ws.close(); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);
"''', timeout=10)
test("WS 无效 token 拒绝", "REJECTED" in out, out[:30])

# 阶段七：WebSocket 认证（正确 host token）
print("\n--- WebSocket 正确认证 ---")

out, _ = run(f'''cd /root/education-platform/gateway && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token={real_token}&deviceId=primary-host&role=host');
ws.on('message', (data) => {{
  const msg = JSON.parse(data);
  console.log('MSG:' + msg.type);
  if (msg.type === 'connected') {{ ws.close(); process.exit(0); }}
}});
ws.on('error', (e) => {{ console.log('ERROR:' + e.message); process.exit(1); }});
setTimeout(() => {{ console.log('TIMEOUT'); process.exit(1); }}, 5000);
"''', timeout=10)
test("WS 正确 token 连接", "MSG:connected" in out, out[:50])

# 阶段八：Backend WS 连接验证
print("\n--- Backend WS 连接验证 ---")

out, _ = run("grep 'connected\\|连接成功' /root/.pm2/logs/scheduling-backend-prod-out.log 2>/dev/null | tail -2")
test("Backend WS 已连接", "连接成功" in out or "connected" in out, out[:80] if out else "无连接日志")

# 阶段九：主机在线状态
print("\n--- 主机在线状态 ---")

out, _ = run("curl -s http://localhost:3001/api/cloud/host/status")
try:
    data = json.loads(out)
    test("主机状态查询", data.get("success") == True, str(data)[:100])
except: test("主机状态查询", False, out[:80])

# 汇总
print("\n" + "=" * 60)
passed = sum(1 for _, p, _ in results if p)
failed = sum(1 for _, p, _ in results if not p)
print(f"结果: {passed}/{len(results)} 通过, {failed} 失败")
for name, p, d in results:
    if not p: print(f"  NEEDS FIX: {name} ({d})")
if failed == 0: print("ALL PASSED!")

ssh.close()
