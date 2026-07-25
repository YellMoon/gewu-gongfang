# WebSocket Cloud Relay 实现文档

## 概述

本功能将桌面客户端与数据主机之间的云端通信从长轮询升级为 WebSocket + HTTP 降级架构，显著降低同步延迟（从 1-2 分钟降至近实时）。

## 架构

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   桌面客户端    │ ◄────────────────► │     Gateway     │
│  (Desktop)      │                    │  (阿里云 ECS)   │
└─────────────────┘                    └─────────────────┘
                                              │
                                              │ WebSocket
                                              ▼
                                       ┌─────────────────┐
                                       │   数据主机      │
                                       │  (Backend)      │
                                       └─────────────────┘
```

## 组件

### 1. Gateway WebSocket 服务器
- **位置**: `gateway/src/websocket/`
- **文件**:
  - `server.js` - CloudWebSocketServer 类
  - `connectionManager.js` - 连接池管理
  - `authMiddleware.js` - JWT 认证
- **端点**: `ws://gateway:3001/ws/cloud-relay`

### 2. Backend WebSocket 客户端（主机端）
- **位置**: `backend/src/websocket/client.js`
- **功能**:
  - 连接到 Gateway 接收任务通知
  - 自动重连（最大 10 次）
  - 心跳保持连接

### 3. Frontend WebSocket 客户端（桌面端）
- **位置**: `src/services/websocketClient.mjs`
- **功能**:
  - 连接到 Gateway 接收任务完成通知
  - 自动重连（最大 10 次）
  - 回退到 HTTP 轮询

### 4. 共享云端 Relay 逻辑
- **位置**: `shared/cloudRelayLogic.js`
- **功能**:
  - 常量定义（TASK_STATUS, TASK_TYPES）
  - 哈希函数（requestHash, resultHash）
  - 错误处理（taskError）

## 消息类型

| 类型 | 方向 | 描述 |
|------|------|------|
| `new_task` | Gateway → Host | 新任务创建通知 |
| `task_complete` | Gateway → Desktop | 任务完成通知 |
| `task_progress` | Gateway → Desktop | 任务进度更新 |
| `host_status` | Gateway → Desktop | 主机在线状态 |
| `ping` | 双向 | 心跳请求 |
| `pong` | 双向 | 心跳响应 |

## 集成点

### Gateway 路由
- `POST /api/cloud/desktop-sync/requests` - 创建任务时通知主机
- `POST /api/cloud/tasks/:id/complete` - 任务完成时通知桌面

### OneClickSyncTransport
- `createCloudRelaySyncTransport` 现在支持 WebSocket
- 优先使用 WebSocket 获取实时通知
- WebSocket 不可用时回退到 HTTP 轮询

## 配置

### 环境变量
```bash
# Gateway
GATEWAY_PORT=3001
GEWU_CLOUD_RELAY_HOST_TOKEN=your-host-token

# Backend
HOST_DEVICE_ID=primary-host
GATEWAY_WS_URL=ws://gateway:3001
GEWU_CLOUD_RELAY_HOST_TOKEN=your-host-token
```

### 依赖
- `ws` - WebSocket 库（已在 gateway 和 backend 的 package.json 中添加）

## 测试

运行同步相关测试：
```bash
npm run test:sync-identity
```

## 部署

1. 更新 Gateway 和 Backend 的 `package.json` 添加 `ws` 依赖
2. 部署 Gateway 到阿里云 ECS
3. 部署 Backend 到本地数据主机
4. 桌面客户端通过 OSS 更新自动获取新版本

## 性能改进

- **之前**: 长轮询，延迟 1-2 分钟
- **之后**: WebSocket 实时通知，延迟 < 1 秒

## 故障排除

### WebSocket 连接失败
- 检查网络连接和防火墙设置
- 验证 Gateway 地址和端口
- 检查 JWT Token 是否有效

### 无限重连
- WebSocket 客户端有最大重连次数限制（默认 10 次）
- 达到限制后停止重连并触发 `max_reconnect_attempts` 事件

## 后续工作

1. 添加 WebSocket 连接监控和告警
2. 实现 WebSocket 连接池优化
3. 添加消息队列保证可靠传递
4. 实现 WebSocket 连接加密（WSS）