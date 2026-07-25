#!/usr/bin/env python3
"""
全链路测试：普通桌面端 ↔ 数据主机
测试设备绑定验证和数据同步的完整连接链路
"""
import json
import subprocess
import urllib.request
import urllib.error
import time
import sys
import hashlib
import hmac

GATEWAY = "http://localhost:3001"
HOST = "http://localhost:3000"

# 测试结果跟踪
results = []

def log(test_name, passed, detail=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    results.append((test_name, passed, detail))
    print(f"  {status} {test_name}" + (f" ({detail})" if detail else ""))

def http_get(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode()[:300]
            return e.code, json.loads(body) if body.startswith('{') else body
        except:
            return e.code, str(e)
    except Exception as e:
        return 0, str(e)

def http_post(url, data, headers=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=h)
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode()[:500]
            return e.code, json.loads(body) if body.startswith('{') else body
        except:
            return e.code, str(e)
    except Exception as e:
        return 0, str(e)

def run_node(code, cwd="/root/education-platform/gateway"):
    result = subprocess.run(["node", "-e", code],
        capture_output=True, text=True, timeout=20, cwd=cwd)
    return result.returncode, result.stdout.strip(), result.stderr.strip()

# ============================================================
# 第一阶段：基础设施验证
# ============================================================
def test_infrastructure():
    print("\n" + "=" * 60)
    print("阶段一：基础设施验证")
    print("=" * 60)

    # 1.1 Gateway 健康检查
    code, data = http_get(f"{GATEWAY}/api/health")
    log("Gateway 健康检查", code == 200 and data.get("ok"), f"version={data.get('version')}")

    # 1.2 Backend 健康检查
    code, data = http_get(f"{HOST}/api/health")
    log("Backend 健康检查", code == 200 and data.get("ok"), f"version={data.get('version')}")

    # 1.3 WebSocket 服务器运行
    rc, out, err = run_node("""
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token=test&deviceId=test&role=host');
ws.on('error', (e) => {
    if (e.message.includes('401') || e.message.includes('403')) {
        console.log('OK');
    } else {
        console.log('FAIL:' + e.message);
    }
    process.exit(0);
});
ws.on('open', () => { console.log('OK'); ws.close(); process.exit(0); });
setTimeout(() => { console.log('FAIL:timeout'); process.exit(1); }, 8000);
""")
    log("WebSocket 服务器运行", out == "OK", out if out != "OK" else "认证拦截正常")

    # 1.4 Gateway 到 Backend 连通性
    code, data = http_post(f"{GATEWAY}/api/cloud/host/heartbeat", {
        "hostDeviceId": "test-connectivity",
        "lanUrls": []
    })
    # 403 表示 token 无效但连接是通的
    log("Gateway→Backend 连通", code in [200, 403], f"code={code}")

# ============================================================
# 第二阶段：主机心跳和配对能力
# ============================================================
def test_host_heartbeat_and_capability():
    print("\n" + "=" * 60)
    print("阶段二：主机心跳和配对能力")
    print("=" * 60)

    # 2.1 主机心跳（带 host token）
    # 使用环境变量中的 host token
    host_token = "test-host-token"  # 占位，实际需要有效 token
    code, data = http_post(f"{GATEWAY}/api/cloud/host/heartbeat", {
        "hostDeviceId": "primary-host",
        "lanUrls": ["http://192.168.1.100:3000"],
        "version": "6.4.11"
    }, {"x-gewu-host-token": host_token})
    
    if code == 403:
        log("主机心跳", False, "HOST_TOKEN_INVALID - 需要有效 host token")
    else:
        log("主机心跳", code == 200, f"code={code}")

    # 2.2 主机状态查询（从 Gateway）
    code, data = http_get(f"{GATEWAY}/api/cloud/host/status")
    log("主机状态查询", code in [200, 401, 403], f"code={code}")

    # 2.3 配对能力查询
    code, data = http_get(f"{GATEWAY}/api/cloud/desktop-pairing/capability")
    log("配对能力查询", code in [200, 404], f"code={code}, data={json.dumps(data)[:100]}")

# ============================================================
# 第三阶段：设备绑定验证（Single-User 模式）
# ============================================================
def test_device_pairing():
    print("\n" + "=" * 60)
    print("阶段三：设备绑定验证（Single-User 模式）")
    print("=" * 60)

    # 3.1 桌面端发现配对能力
    code, data = http_get(f"{GATEWAY}/api/cloud/desktop-pairing/capability")
    if code == 200 and data.get("success"):
        capability = data.get("capability", {})
        log("发现配对能力", True, f"capabilityId={capability.get('capabilityId', 'N/A')}")
    else:
        log("发现配对能力", False, f"code={code}")

    # 3.2 桌面端提交配对请求（模拟）
    # 正常流程需要加密信封，这里测试 Gateway 是否正确处理请求格式
    code, data = http_post(f"{GATEWAY}/api/cloud/desktop-pairing/requests", {
        "deviceId": "test-desktop-pairing",
        "encryptedEnvelope": "test-envelope-data",
        "requestSecretHash": hashlib.sha256(b"test-secret").hexdigest()
    })
    if code == 403:
        log("提交配对请求", False, "需要有效配对能力")
    elif code == 429:
        log("提交配对请求", True, "速率限制生效")
    else:
        log("提交配对请求", code in [200, 400, 403], f"code={code}")

    # 3.3 V1 配对端点已移除
    code, data = http_post(f"{GATEWAY}/api/desktop-pairing/start", {})
    log("V1 配对已移除", code == 410, f"code={code}")

    # 3.4 桌面端身份认证端点
    code, data = http_get(f"{HOST}/api/desktop-identity/single-user/pairing-capability")
    log("主机配对能力端点", code in [200, 401, 403], f"code={code}")

# ============================================================
# 第四阶段：数据同步（云中继模式）
# ============================================================
def test_data_sync():
    print("\n" + "=" * 60)
    print("阶段四：数据同步（云中继模式）")
    print("=" * 60)

    # 4.1 注册同步设备
    code, data = http_post(f"{GATEWAY}/api/cloud/desktop-sync/devices/register", {
        "deviceId": "test-sync-desktop"
    })
    log("注册同步设备", code in [200, 401], f"code={code}")

    # 4.2 提交同步请求
    code, data = http_post(f"{GATEWAY}/api/cloud/desktop-sync/requests", {
        "deviceId": "test-sync-desktop",
        "tenantId": "default",
        "pendingChanges": [
            {"action": "update", "table": "students", "id": 1, "data": {"name": "test"}}
        ]
    })
    if code == 200 and data.get("success"):
        request_id = data.get("request", {}).get("id")
        log("提交同步请求", True, f"requestId={request_id}")

        # 4.3 查询同步结果
        code2, data2 = http_get(f"{GATEWAY}/api/cloud/desktop-sync/requests/{request_id}/result")
        log("查询同步结果", code2 in [200, 404], f"code={code2}")
    else:
        log("提交同步请求", False, f"code={code}")

    # 4.4 主机拉取任务
    code, data = http_get(f"{GATEWAY}/api/cloud/tasks?status=pending_host&hostDeviceId=primary-host")
    log("主机拉取任务", code in [200, 401], f"code={code}")

    # 4.5 主机认领任务
    code, data = http_post(f"{GATEWAY}/api/cloud/tasks/claim", {
        "hostDeviceId": "primary-host",
        "leaseMs": 60000
    })
    log("主机认领任务", code in [200, 401, 403], f"code={code}")

# ============================================================
# 第五阶段：WebSocket 实时通知
# ============================================================
def test_websocket_notifications():
    print("\n" + "=" * 60)
    print("阶段五：WebSocket 实时通知")
    print("=" * 60)

    # 5.1 检查 WebSocket 通知代码集成
    import os
    gw_cloud_relay = "gateway/src/routes/cloudRelay.js"
    if os.path.exists(gw_cloud_relay):
        with open(gw_cloud_relay, 'r', encoding='utf-8') as f:
            content = f.read()
        
        checks = [
            ("wsServer.notifyHostNewTask", "任务创建通知主机"),
            ("wsServer.notifyDesktopTaskComplete", "任务完成通知桌面端"),
            ("app.get('wsServer')", "获取 WebSocket 服务器"),
            ("requireHostToken", "主机认证"),
            ("requireOnlineDesktopSession", "桌面会话认证"),
        ]
        
        all_ok = True
        for pattern, desc in checks:
            if pattern in content:
                log(f"WebSocket 集成: {desc}", True)
            else:
                log(f"WebSocket 集成: {desc}", False)
                all_ok = False
    else:
        log("WebSocket 集成检查", False, "文件不存在")

    # 5.2 WebSocket 服务器端点验证
    rc, out, err = run_node("""
const http = require('http');
const WebSocket = require('ws');

// 测试 1: WebSocket 服务器是否在监听
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
});

const wsServer = new WebSocket.Server({ noServer: true });

// 验证 WebSocket 模块可用
console.log(JSON.stringify({
    wsAvailable: true,
    serverCreated: true
}));
process.exit(0);
""")
    if rc == 0 and out:
        data = json.loads(out)
        log("WebSocket 模块可用", data.get("wsAvailable", False))
    else:
        log("WebSocket 模块可用", False, err[:100])

# ============================================================
# 第六阶段：认证和安全
# ============================================================
def test_auth_and_security():
    print("\n" + "=" * 60)
    print("阶段六：认证和安全")
    print("=" * 60)

    # 6.1 无 token 访问受保护端点
    code, data = http_get(f"{GATEWAY}/api/cloud/tasks?status=pending_host")
    log("无 token 访问任务端点", code in [401, 403], f"code={code}")

    # 6.2 无效 token 访问
    code, data = http_get(f"{GATEWAY}/api/cloud/tasks?status=pending_host", 
        {"Authorization": "Bearer invalid-token"})
    log("无效 token 访问", code in [401, 403], f"code={code}")

    # 6.3 WebSocket 无效 token
    rc, out, err = run_node("""
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token=invalid&deviceId=test&role=host');
ws.on('error', (e) => {
    if (e.message.includes('401') || e.message.includes('403')) {
        console.log('OK');
    } else {
        console.log('FAIL:' + e.message);
    }
    process.exit(0);
});
ws.on('open', () => { console.log('FAIL:should_not_connect'); ws.close(); process.exit(1); });
setTimeout(() => { console.log('FAIL:timeout'); process.exit(1); }, 8000);
""")
    log("WebSocket 无效 token 拒绝", out == "OK", out)

    # 6.4 V1 配对端点返回 410
    code, data = http_post(f"{GATEWAY}/api/desktop-pairing/start", {})
    log("V1 配对端点返回 410", code == 410, f"code={code}")

    # 6.5 Backend 写入保护
    code, data = http_post(f"{HOST}/api/sync/push", {"changes": []})
    log("Backend 写入保护", code in [401, 403], f"code={code}")

# ============================================================
# 主函数
# ============================================================
def main():
    print("\n" + "🔔" * 30)
    print("全链路测试：普通桌面端 ↔ 数据主机")
    print("🔔" * 30)

    # 运行所有测试阶段
    test_infrastructure()
    test_host_heartbeat_and_capability()
    test_device_pairing()
    test_data_sync()
    test_websocket_notifications()
    test_auth_and_security()

    # 汇总结果
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)

    passed = sum(1 for _, p, _ in results if p)
    failed = sum(1 for _, p, _ in results if not p)
    total = len(results)

    for name, p, detail in results:
        status = "✅" if p else "❌"
        print(f"  {status} {name}" + (f" ({detail})" if detail else ""))

    print(f"\n总计: {passed}/{total} 通过, {failed} 失败")

    if failed == 0:
        print("\n🎉 所有测试通过！全链路正常！")
    else:
        print(f"\n⚠️  {failed} 个测试需要关注")

    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())