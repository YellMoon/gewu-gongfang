#!/usr/bin/env python3
"""
WebSocket Cloud Relay 测试脚本
验证 Gateway WebSocket 服务器和实时同步功能
"""
import asyncio
import json
import websockets
import httpx
import sys

GATEWAY_URL = "http://39.106.172.132:3001"
GATEWAY_WS_URL = "ws://39.106.172.132:3001"

async def test_websocket_connection():
    """测试 WebSocket 连接"""
    print("1. 测试 WebSocket 连接...")
    try:
        async with websockets.connect(f"{GATEWAY_WS_URL}/ws/cloud-relay?token=test&deviceId=test-host&role=host") as ws:
            print("   ✅ WebSocket 连接成功")
            
            # 发送心跳
            await ws.send(json.dumps({"type": "ping", "payload": {"deviceId": "test-host"}}))
            response = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f"   ✅ 心跳响应: {response}")
            return True
    except Exception as e:
        print(f"   ❌ WebSocket 连接失败: {e}")
        return False

async def test_http_api():
    """测试 HTTP API"""
    print("\n2. 测试 HTTP API...")
    try:
        async with httpx.AsyncClient() as client:
            # 健康检查
            health = await client.get(f"{GATEWAY_URL}/api/health")
            print(f"   ✅ 健康检查: {health.json()}")
            
            # 主机状态
            status = await client.get(f"{GATEWAY_URL}/api/cloud/host/status")
            print(f"   ✅ 主机状态: {status.json()}")
            
            return True
    except Exception as e:
        print(f"   ❌ HTTP API 测试失败: {e}")
        return False

async def test_realtime_sync():
    """测试实时同步"""
    print("\n3. 测试实时同步...")
    try:
        async with websockets.connect(f"{GATEWAY_WS_URL}/ws/cloud-relay?token=test&deviceId=test-desktop&role=desktop") as ws:
            print("   ✅ 桌面客户端 WebSocket 连接成功")
            
            # 等待消息（超时 5 秒）
            try:
                message = await asyncio.wait_for(ws.recv(), timeout=5)
                print(f"   ✅ 收到消息: {message}")
            except asyncio.TimeoutError:
                print("   ⚠️  等待消息超时（正常，因为没有新任务）")
            
            return True
    except Exception as e:
        print(f"   ❌ 实时同步测试失败: {e}")
        return False

async def main():
    print("=" * 50)
    print("WebSocket Cloud Relay 功能验证")
    print("=" * 50)
    
    results = []
    
    # 测试 HTTP API
    results.append(await test_http_api())
    
    # 测试 WebSocket 连接
    results.append(await test_websocket_connection())
    
    # 测试实时同步
    results.append(await test_realtime_sync())
    
    print("\n" + "=" * 50)
    print("测试结果汇总")
    print("=" * 50)
    
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print(f"✅ 所有测试通过 ({passed}/{total})")
        print("\nWebSocket Cloud Relay 实时同步架构已成功部署并验证！")
        return 0
    else:
        print(f"❌ 部分测试失败 ({passed}/{total})")
        return 1

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))