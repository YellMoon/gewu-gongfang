#!/usr/bin/env python3
"""Simple WebSocket test for remote server"""
import asyncio
import json

try:
    import websockets
except ImportError:
    import subprocess
    subprocess.check_call(['pip', 'install', 'websockets', '-q'])
    import websockets

async def test():
    print("测试 WebSocket 连接...")
    try:
        async with websockets.connect("ws://localhost:3001/ws/cloud-relay?token=test&deviceId=test-host&role=host") as ws:
            print("✅ WebSocket 连接成功")
            
            # 发送心跳
            await ws.send(json.dumps({"type": "ping", "payload": {"deviceId": "test-host"}}))
            response = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f"✅ 心跳响应: {response}")
            
            print("✅ 所有测试通过")
            return True
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        return False

if __name__ == "__main__":
    asyncio.run(test())