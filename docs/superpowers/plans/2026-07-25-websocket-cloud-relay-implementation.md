# WebSocket + HTTP降级云中继优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面端与数据主机之间的外网通信从长轮询模式升级为WebSocket实时通信，同时保留HTTP作为降级方案，解决同步延迟高、连接开销大的问题。

**Architecture:** 采用WebSocket实时通信 + HTTP降级的混合架构，在Gateway部署WebSocket服务器，数据主机和桌面客户端作为WebSocket客户端连接。提取Gateway和Backend的共享逻辑到公共模块，消除代码重复。

**Tech Stack:** Node.js, ws (WebSocket库), JWT/HMAC认证, 原生WebSocket API (前端), Express (现有)

---

## 阶段1: 代码重构 - 提取共享逻辑

### Task 1: 创建共享云中继逻辑模块

**Files:**
- Create: `shared/cloudRelayLogic.js`
- Modify: `backend/src/services/cloudRelayClient.js:1-170`
- Modify: `gateway/src/services/cloudRelayTaskService.js:1-303`

- [ ] **Step 1: 创建shared目录和基础模块结构**

```javascript
// shared/cloudRelayLogic.js
const crypto = require('crypto');

// 任务状态常量
const TASK_STATUS = {
  PENDING_HOST: 'pending_host',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// 任务类型常量
const TASK_TYPES = {
  DESKTOP_SYNC: 'desktop-sync',
  DESKTOP_IDENTITY: 'desktop-identity',
  DESKTOP_SESSION_CHALLENGE_START: 'desktop-session-challenge-start',
  DESKTOP_SESSION_CHALLENGE_EXCHANGE: 'desktop-session-challenge-exchange',
  IDENTITY_PROVISIONING: 'identity-provisioning',
  QUESTION_PAPER: 'question-paper',
  PAPER_EXPORT_WORD: 'paper-export-word',
  PAPER_EXPORT-pdf: 'paper-export-pdf',
  ASSET_IMPORT: 'asset-import',
};

// 内部任务类型（不允许通过公共流程创建）
const INTERNAL_TASK_TYPES = new Set([
  'identity-provisioning',
  'desktop-session-challenge-start',
  'desktop-session-challenge-exchange',
]);

module.exports = {
  TASK_STATUS,
  TASK_TYPES,
  INTERNAL_TASK_TYPES,
};
```

- [ ] **Step 2: 提取任务哈希计算逻辑**

在`shared/cloudRelayLogic.js`中添加：

```javascript
// 稳定化值用于哈希计算
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

// 请求哈希计算
function requestHash(input) {
  const canonical = stableValue({
    taskType: input.taskType,
    payload: input.payload || {},
    tenantId: input.tenantId || 'default',
    actorRole: input.actorRole || '',
    allowDraft: Boolean(input.allowDraft),
    targetHostDeviceId: input.targetHostDeviceId,
    maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
    deadlineAt: input.deadlineAt || null,
    resultExpiresAt: input.resultExpiresAt || null,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// 结果哈希计算
function resultHash(input) {
  const canonicalJson = JSON.stringify(stableValue(input || {}));
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

module.exports = {
  // ... 之前的导出
  stableValue,
  requestHash,
  resultHash,
};
```

- [ ] **Step 3: 提取错误处理逻辑**

在`shared/cloudRelayLogic.js`中添加：

```javascript
// 任务错误创建
function taskError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

// 检查是否为内部任务类型
function isInternalTaskType(taskType) {
  return INTERNAL_TASK_TYPES.has(String(taskType || '').trim());
}

// 解析JSON
function parseJson(value, fallback) {
  try { return value === null || value === undefined ? fallback : JSON.parse(value); } catch (_error) { return fallback; }
}

module.exports = {
  // ... 之前的导出
  taskError,
  isInternalTaskType,
  parseJson,
};
```

- [ ] **Step 4: 提取任务行处理逻辑**

在`shared/cloudRelayLogic.js`中添加：

```javascript
// 任务行处理
function taskRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload: parseJson(row.payload, {}),
    result_payload: parseJson(row.result_payload, null),
    selection_context: parseJson(row.selection_context, {}),
  };
}

module.exports = {
  // ... 之前的导出
  taskRow,
};
```

- [ ] **Step 5: 更新cloudRelayClient.js使用共享逻辑**

修改`backend/src/services/cloudRelayClient.js`：

```javascript
// 在文件开头添加
const { requestHash, resultHash, taskRow, parseJson } = require('../../shared/cloudRelayLogic');

// 移除重复的函数定义：
// - stableValue (已移到shared)
// - requestHash (已移到shared)
// - resultHash (已移到shared)
// - taskRow (已移到shared)
// - parseJson (已移到shared)

// 保留原有导出，添加新的共享逻辑导出
module.exports = {
  // ... 原有导出
  // 添加共享逻辑
  requestHash,
  resultHash,
  taskRow,
  parseJson,
};
```

- [ ] **Step 6: 更新cloudRelayTaskService.js使用共享逻辑**

修改`gateway/src/services/cloudRelayTaskService.js`：

```javascript
// 在文件开头添加
const {
  TASK_STATUS,
  INTERNAL_TASK_TYPES,
  stableValue,
  requestHash,
  resultHash,
  taskError,
  isInternalTaskType,
  parseJson,
  taskRow,
} = require('../../shared/cloudRelayLogic');

// 移除重复的函数定义：
// - PROGRESS_PHASES (保留在本地，因为它是特定于任务服务的)
// - INTERNAL_TASK_TYPES (已移到shared)
// - taskError (已移到shared)
// - isInternalTaskType (已移到shared)
// - stableValue (已移到shared)
// - requestHash (已移到shared)
// - resultHash (已移到shared)
// - parseJson (已移到shared)
// - taskRow (已移到shared)

// 保留原有导出，添加新的共享逻辑导出
module.exports = {
  // ... 原有导出
  // 添加共享逻辑
  TASK_STATUS,
  requestHash,
  resultHash,
  taskRow,
  parseJson,
};
```

- [ ] **Step 7: 运行测试验证重构**

Run: `npm test`
Expected: 所有测试通过，功能保持不变

- [ ] **Step 8: 提交代码**

```bash
git add shared/cloudRelayLogic.js backend/src/services/cloudRelayClient.js gateway/src/services/cloudRelayTaskService.js
git commit -m "refactor: 提取云中继共享逻辑到公共模块"
```

### Task 2: 统一Gateway和Backend的云中继路由

**Files:**
- Create: `shared/cloudRelayRoutes.js`
- Modify: `backend/src/routes/cloudRelayHost.js:1-696`
- Modify: `gateway/src/routes/cloudRelay.js:1-695`

- [ ] **Step 1: 创建共享路由处理器**

```javascript
// shared/cloudRelayRoutes.js
const { taskError, taskRow, parseJson } = require('./cloudRelayLogic');

// 通用错误处理
function taskRouteError(res, error) {
  return res.status(Number(error.statusCode) || 500).json({
    success: false,
    code: error.code || 'TASK_OPERATION_FAILED',
    error: error.message,
  });
}

// 通用任务状态查询
function getTaskState(db, taskId, hostDeviceId) {
  const row = db.prepare(`SELECT id,status,result_payload,row_version,error_code,artifact_id,job_key,snapshot_hash
    FROM miniapp_tasks WHERE id=? AND (target_host_device_id=? OR claimed_by=?)`).get(taskId, hostDeviceId, hostDeviceId);
  if (!row) return null;
  return {
    ...row,
    result_payload: row.result_payload ? parseJson(row.result_payload, null) : null,
  };
}

module.exports = {
  taskRouteError,
  getTaskState,
};
```

- [ ] **Step 2: 更新Backend路由使用共享逻辑**

修改`backend/src/routes/cloudRelayHost.js`：

```javascript
// 在文件开头添加
const { taskRouteError, getTaskState } = require('../../shared/cloudRelayRoutes');
const { taskRow, parseJson } = require('../../shared/cloudRelayLogic');

// 移除重复的函数定义：
// - taskRouteError (已移到shared)
// - 保留 authOptionsFromRequest (特定于Backend)
// - 保留 hostDeviceId (特定于Backend)
// - 保留 hostLanUrls (特定于Backend)

// 更新路由处理器使用共享逻辑
// 例如：router.get('/tasks/:id/state', ...) 使用 getTaskState
```

- [ ] **Step 3: 更新Gateway路由使用共享逻辑**

修改`gateway/src/routes/cloudRelay.js`：

```javascript
// 在文件开头添加
const { taskRouteError, getTaskState } = require('../../shared/cloudRelayRoutes');
const { taskRow, parseJson } = require('../../shared/cloudRelayLogic');

// 移除重复的函数定义：
// - taskRouteError (已移到shared)
// - 保留 requireHostToken (特定于Gateway)
// - 保留 requireOnlineDesktopSession (特定于Gateway)
// - 保留 requireApprovedSnapshotUser (特定于Gateway)

// 更新路由处理器使用共享逻辑
// 例如：router.get('/tasks/:id/state', ...) 使用 getTaskState
```

- [ ] **Step 4: 运行测试验证重构**

Run: `npm test`
Expected: 所有测试通过，功能保持不变

- [ ] **Step 5: 提交代码**

```bash
git add shared/cloudRelayRoutes.js backend/src/routes/cloudRelayHost.js gateway/src/routes/cloudRelay.js
git commit -m "refactor: 统一Gateway和Backend云中继路由逻辑"
```

## 阶段2: WebSocket服务器实现

### Task 3: 创建WebSocket服务器核心

**Files:**
- Create: `gateway/src/websocket/server.js`
- Create: `gateway/src/websocket/connectionManager.js`
- Create: `gateway/src/websocket/authMiddleware.js`

- [ ] **Step 1: 安装WebSocket依赖**

Run: `cd gateway && npm install ws`
Expected: ws库安装成功

- [ ] **Step 2: 创建连接管理器**

```javascript
// gateway/src/websocket/connectionManager.js
class ConnectionManager {
  constructor() {
    this.connections = new Map(); // deviceId -> { ws, userId, role, lastHeartbeat }
    this.heartbeatInterval = 30000; // 30秒心跳间隔
    this.heartbeatTimeout = 60000; // 60秒超时
    this.startHeartbeatCheck();
  }

  // 添加连接
  addConnection(deviceId, ws, userId, role) {
    // 关闭现有连接
    const existing = this.connections.get(deviceId);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.close(1000, 'New connection established');
    }

    this.connections.set(deviceId, {
      ws,
      userId,
      role,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
    });

    console.log(`[WebSocket] Device connected: ${deviceId} (user: ${userId}, role: ${role})`);
  }

  // 移除连接
  removeConnection(deviceId) {
    const connection = this.connections.get(deviceId);
    if (connection) {
      console.log(`[WebSocket] Device disconnected: ${deviceId}`);
      this.connections.delete(deviceId);
    }
  }

  // 更新心跳
  updateHeartbeat(deviceId) {
    const connection = this.connections.get(deviceId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
    }
  }

  // 发送消息到指定设备
  sendToDevice(deviceId, message) {
    const connection = this.connections.get(deviceId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // 广播消息到所有连接
  broadcast(message, excludeDeviceId = null) {
    const messageStr = JSON.stringify(message);
    for (const [deviceId, connection] of this.connections.entries()) {
      if (deviceId !== excludeDeviceId && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageStr);
      }
    }
  }

  // 广播消息到指定角色的设备
  broadcastToRole(role, message, excludeDeviceId = null) {
    const messageStr = JSON.stringify(message);
    for (const [deviceId, connection] of this.connections.entries()) {
      if (deviceId !== excludeDeviceId && connection.role === role && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageStr);
      }
    }
  }

  // 检查心跳超时
  startHeartbeatCheck() {
    setInterval(() => {
      const now = Date.now();
      for (const [deviceId, connection] of this.connections.entries()) {
        if (now - connection.lastHeartbeat > this.heartbeatTimeout) {
          console.log(`[WebSocket] Heartbeat timeout for device: ${deviceId}`);
          connection.ws.close(1000, 'Heartbeat timeout');
          this.removeConnection(deviceId);
        }
      }
    }, this.heartbeatInterval);
  }

  // 获取连接统计
  getStats() {
    return {
      totalConnections: this.connections.size,
      connectionsByRole: Array.from(this.connections.values()).reduce((acc, conn) => {
        acc[conn.role] = (acc[conn.role] || 0) + 1;
        return acc;
      }, {}),
    };
  }
}

module.exports = ConnectionManager;
```

- [ ] **Step 3: 创建认证中间件**

```javascript
// gateway/src/websocket/authMiddleware.js
const jwt = require('jsonwebtoken');

function authenticateWebSocket(req, socket, next) {
  try {
    // 从查询参数或头部获取token
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 验证token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 检查是否为桌面端会话
    if (decoded.clientType !== 'desktop' || decoded.tokenUse !== 'desktop-session') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // 将用户信息附加到请求对象
    req.user = {
      userId: decoded.userId,
      deviceId: decoded.deviceId,
      sessionId: decoded.sessionId,
      activeRole: decoded.activeRole,
      teacherId: decoded.teacherId,
      authVersion: decoded.authVersion,
      credentialVersion: decoded.credentialVersion,
    };

    next();
  } catch (error) {
    console.error('[WebSocket] Authentication failed:', error.message);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
}

module.exports = { authenticateWebSocket };
```

- [ ] **Step 4: 创建WebSocket服务器主文件**

```javascript
// gateway/src/websocket/server.js
const WebSocket = require('ws');
const url = require('url');
const { authenticateWebSocket } = require('./authMiddleware');
const ConnectionManager = require('./connectionManager');

class CloudWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ noServer: true });
    this.connectionManager = new ConnectionManager();
    this.setupWebSocket(server);
    this.setupMessageHandlers();
  }

  setupWebSocket(server) {
    // 处理升级请求
    server.on('upgrade', (req, socket, head) => {
      // 先进行认证
      authenticateWebSocket(req, socket, (err) => {
        if (err) return;
        
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      });
    });

    // 处理连接
    this.wss.on('connection', (ws, req) => {
      const user = req.user;
      console.log(`[WebSocket] New connection from device: ${user.deviceId}`);

      // 添加到连接管理器
      this.connectionManager.addConnection(user.deviceId, ws, user.userId, user.activeRole);

      // 发送连接成功消息
      ws.send(JSON.stringify({
        type: 'connected',
        deviceId: user.deviceId,
        serverTime: Date.now(),
      }));

      // 处理断开连接
      ws.on('close', () => {
        this.connectionManager.removeConnection(user.deviceId);
      });

      // 处理错误
      ws.on('error', (error) => {
        console.error(`[WebSocket] Error for device ${user.deviceId}:`, error);
        this.connectionManager.removeConnection(user.deviceId);
      });
    });
  }

  setupMessageHandlers() {
    // 心跳处理
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          switch (message.type) {
            case 'heartbeat':
              this.handleHeartbeat(ws, message);
              break;
            case 'task_ack':
              this.handleTaskAck(ws, message);
              break;
            default:
              console.log('[WebSocket] Unknown message type:', message.type);
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      });
    });
  }

  handleHeartbeat(ws, message) {
    const deviceId = message.deviceId;
    this.connectionManager.updateHeartbeat(deviceId);
    
    ws.send(JSON.stringify({
      type: 'heartbeat_ack',
      serverTime: Date.now(),
    }));
  }

  handleTaskAck(ws, message) {
    const { taskId, status } = message;
    console.log(`[WebSocket] Task ${taskId} acknowledged with status: ${status}`);
    
    // 这里可以添加任务确认逻辑
  }

  // 通知主机有新任务
  notifyHostNewTask(hostDeviceId, taskInfo) {
    const sent = this.connectionManager.sendToDevice(hostDeviceId, {
      type: 'new_task',
      task: taskInfo,
      timestamp: Date.now(),
    });
    
    if (!sent) {
      console.log(`[WebSocket] Host ${hostDeviceId} not connected, task will be picked up via HTTP`);
    }
    
    return sent;
  }

  // 通知桌面客户端任务完成
  notifyDesktopTaskComplete(deviceId, taskResult) {
    const sent = this.connectionManager.sendToDevice(deviceId, {
      type: 'task_complete',
      result: taskResult,
      timestamp: Date.now(),
    });
    
    if (!sent) {
      console.log(`[WebSocket] Desktop ${deviceId} not connected, result will be available via HTTP`);
    }
    
    return sent;
  }

  // 广播主机状态更新
  broadcastHostStatus(hostDeviceId, status) {
    this.connectionManager.broadcastToRole('desktop-client', {
      type: 'host_status_update',
      hostDeviceId,
      status,
      timestamp: Date.now(),
    });
  }

  // 获取服务器统计
  getStats() {
    return this.connectionManager.getStats();
  }
}

module.exports = CloudWebSocketServer;
```

- [ ] **Step 5: 集成到Gateway服务器**

修改`gateway/src/app.js`：

```javascript
// 在文件开头添加
const http = require('http');
const CloudWebSocketServer = require('./websocket/server');

// 在创建Express app后添加
const app = express();
const server = http.createServer(app);

// 初始化WebSocket服务器
const wsServer = new CloudWebSocketServer(server);

// 将wsServer附加到app上，以便路由可以访问
app.set('wsServer', wsServer);

// 修改监听端口为server.listen
// 原来：app.listen(PORT, ...)
// 改为：server.listen(PORT, ...)

// 导出server以便测试
module.exports = { app, server, wsServer };
```

- [ ] **Step 6: 更新路由使用WebSocket通知**

修改`gateway/src/routes/cloudRelay.js`：

```javascript
// 在任务创建后添加WebSocket通知
router.post('/desktop-sync/requests', requireOnlineDesktopSession, (req, res) => {
  // ... 原有代码 ...

  // 在返回响应前，通知主机有新任务
  const wsServer = req.app.get('wsServer');
  if (wsServer) {
    // 获取主机设备ID（从数据库或配置）
    const hostDeviceId = targetHostForTask(db, req.body.targetHostDeviceId);
    wsServer.notifyHostNewTask(hostDeviceId, {
      taskId,
      taskType: 'desktop-sync',
      deviceId: actor.deviceId,
      createdAt: time,
    });
  }

  return res.json({ success: true, request: { id: taskId, status: 'pending_host', acceptedChanges: payload.pendingChanges.length } });
});
```

- [ ] **Step 7: 运行测试验证WebSocket服务器**

Run: `cd gateway && npm test`
Expected: 所有测试通过

- [ ] **Step 8: 提交代码**

```bash
git add gateway/src/websocket/ gateway/src/app.js gateway/src/routes/cloudRelay.js gateway/package.json
git commit -m "feat: 实现WebSocket服务器核心功能"
```

### Task 4: 实现WebSocket任务完成通知

**Files:**
- Modify: `gateway/src/routes/cloudRelay.js:629-661`
- Modify: `gateway/src/websocket/server.js`

- [ ] **Step 1: 在任务完成时发送WebSocket通知**

修改`gateway/src/routes/cloudRelay.js`中的`/tasks/:id/complete`路由：

```javascript
router.post('/tasks/:id/complete', requireHostToken, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT protocol_version,task_type,created_by FROM miniapp_tasks WHERE id=?').get(req.params.id);
  if (Number(existing?.protocol_version || 1) >= 2) {
    try {
      const completionInput = existing.task_type === 'desktop-pairing'
        ? { ...(req.body || {}), result: sanitizePairingResult(req.body?.result) }
        : (req.body || {});
      const task = taskService.completeV2Task(db, req.params.id, completionInput);
      
      // 发送WebSocket通知给桌面客户端
      if (existing.task_type === 'desktop-sync' && existing.created_by) {
        const wsServer = req.app.get('wsServer');
        if (wsServer) {
          wsServer.notifyDesktopTaskComplete(existing.created_by, {
            taskId: req.params.id,
            taskType: existing.task_type,
            result: task.result_payload,
            completedAt: new Date().toISOString(),
          });
        }
      }
      
      if (task.task_type === 'desktop-pairing') {
        db.prepare(`UPDATE desktop_pairing_relay_requests
          SET status='completed',result_payload=?,error_code=NULL,updated_at=?,completed_at=?
          WHERE id=? AND status IN ('pending_host','processing')`)
          .run(JSON.stringify(completionInput.result), now(), now(), task.id);
      }
      return res.json({ success: true, task });
    } catch (error) { return taskRouteError(res, error); }
  }
  // ... 原有代码 ...
});
```

- [ ] **Step 2: 添加任务进度WebSocket通知**

修改`gateway/src/routes/cloudRelay.js`中的`/tasks/:id/progress`路由：

```javascript
router.post('/tasks/:id/progress', requireHostToken, (req, res) => {
  try {
    const task = taskService.updateV2TaskProgress(getDb(), req.params.id, req.body || {});
    
    // 发送进度更新给桌面客户端
    if (task.task_type === 'desktop-sync') {
      const wsServer = req.app.get('wsServer');
      if (wsServer) {
        // 从任务payload中获取桌面客户端设备ID
        const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
        if (payload.deviceId) {
          wsServer.notifyDesktopTaskComplete(payload.deviceId, {
            taskId: req.params.id,
            taskType: task.task_type,
            progress: task.progress,
            phase: task.phase,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
    
    return res.json({ success: true, task });
  } catch (error) { return taskRouteError(res, error); }
});
```

- [ ] **Step 3: 运行测试验证通知功能**

Run: `cd gateway && npm test`
Expected: 所有测试通过

- [ ] **Step 4: 提交代码**

```bash
git add gateway/src/routes/cloudRelay.js
git commit -m "feat: 添加WebSocket任务完成和进度通知"
```

## 阶段3: WebSocket客户端实现

### Task 5: 实现数据主机WebSocket客户端

**Files:**
- Create: `backend/src/websocket/client.js`
- Create: `backend/src/websocket/reconnectionManager.js`
- Modify: `backend/src/routes/cloudRelayHost.js:448-586`

- [ ] **Step 1: 安装WebSocket依赖**

Run: `cd backend && npm install ws`
Expected: ws库安装成功

- [ ] **Step 2: 创建重连管理器**

```javascript
// backend/src/websocket/reconnectionManager.js
class ReconnectionManager {
  constructor(options = {}) {
    this.baseDelay = options.baseDelay || 1000; // 基础延迟1秒
    this.maxDelay = options.maxDelay || 30000; // 最大延迟30秒
    this.maxAttempts = options.maxAttempts || 10; // 最大尝试次数
    this.currentAttempt = 0;
    this.currentDelay = this.baseDelay;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
  }

  // 计算下一次重连延迟（指数退避 + 随机抖动）
  getNextDelay() {
    const jitter = Math.random() * 0.5 - 0.25; // -0.25 到 0.25
    const delay = Math.min(this.currentDelay * Math.pow(2, this.currentAttempt) * (1 + jitter), this.maxDelay);
    return Math.floor(delay);
  }

  // 尝试重连
  scheduleReconnect(callback) {
    if (!this.shouldReconnect || this.currentAttempt >= this.maxAttempts) {
      console.log('[Reconnection] Max attempts reached or reconnect disabled');
      return false;
    }

    const delay = this.getNextDelay();
    console.log(`[Reconnection] Scheduling reconnect attempt ${this.currentAttempt + 1} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.currentAttempt++;
      callback();
    }, delay);

    return true;
  }

  // 重置重连状态（连接成功时调用）
  reset() {
    this.currentAttempt = 0;
    this.currentDelay = this.baseDelay;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // 停止重连
  stop() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // 获取状态
  getStatus() {
    return {
      currentAttempt: this.currentAttempt,
      maxAttempts: this.maxAttempts,
      shouldReconnect: this.shouldReconnect,
      nextDelay: this.shouldReconnect ? this.getNextDelay() : null,
    };
  }
}

module.exports = ReconnectionManager;
```

- [ ] **Step 3: 创建数据主机WebSocket客户端**

```javascript
// backend/src/websocket/client.js
const WebSocket = require('ws');
const ReconnectionManager = require('./reconnectionManager');

class HostWebSocketClient {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || process.env.GEWU_CLOUD_BASE_URL;
    this.hostDeviceId = options.hostDeviceId || process.env.GEWU_DEVICE_ID;
    this.hostToken = options.hostToken || process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
    this.ws = null;
    this.reconnectionManager = new ReconnectionManager();
    this.heartbeatInterval = null;
    this.heartbeatTimeout = 30000; // 30秒心跳
    this.isConnected = false;
    this.messageHandlers = new Map();
  }

  // 连接到WebSocket服务器
  connect() {
    if (!this.serverUrl) {
      console.error('[HostWebSocket] Server URL not configured');
      return;
    }

    // 构建WebSocket URL
    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws/host';
    const token = this.hostToken;

    console.log(`[HostWebSocket] Connecting to ${wsUrl}`);

    try {
      this.ws = new WebSocket(`${wsUrl}?token=${token}`);

      this.ws.on('open', () => {
        console.log('[HostWebSocket] Connected to server');
        this.isConnected = true;
        this.reconnectionManager.reset();
        this.startHeartbeat();
        this.sendRegistration();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[HostWebSocket] Failed to parse message:', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[HostWebSocket] Connection closed: ${code} ${reason}`);
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[HostWebSocket] Connection error:', error);
        this.isConnected = false;
      });
    } catch (error) {
      console.error('[HostWebSocket] Failed to create connection:', error);
      this.scheduleReconnect();
    }
  }

  // 发送注册消息
  sendRegistration() {
    this.send({
      type: 'register',
      deviceId: this.hostDeviceId,
      role: 'primary-host',
      capabilities: ['task-processing', 'sync'],
    });
  }

  // 发送消息
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // 处理接收到的消息
  handleMessage(message) {
    console.log('[HostWebSocket] Received message:', message.type);

    switch (message.type) {
      case 'new_task':
        this.handleNewTask(message.task);
        break;
      case 'heartbeat_ack':
        // 心跳确认，无需处理
        break;
      case 'task_cancel':
        this.handleTaskCancel(message.taskId);
        break;
      default:
        console.log('[HostWebSocket] Unknown message type:', message.type);
    }
  }

  // 处理新任务通知
  handleNewTask(taskInfo) {
    console.log(`[HostWebSocket] New task received: ${taskInfo.taskId}`);
    
    // 触发任务处理流程
    // 这里需要与现有的任务处理逻辑集成
    // 可以通过事件总线或直接调用
    if (this.messageHandlers.has('new_task')) {
      this.messageHandlers.get('new_task')(taskInfo);
    }
  }

  // 处理任务取消
  handleTaskCancel(taskId) {
    console.log(`[HostWebSocket] Task cancel received: ${taskId}`);
    
    if (this.messageHandlers.has('task_cancel')) {
      this.messageHandlers.get('task_cancel')(taskId);
    }
  }

  // 注册消息处理器
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  // 开始心跳
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.send({
        type: 'heartbeat',
        deviceId: this.hostDeviceId,
        timestamp: Date.now(),
      });
    }, this.heartbeatTimeout);
  }

  // 停止心跳
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // 安排重连
  scheduleReconnect() {
    this.reconnectionManager.scheduleReconnect(() => {
      this.connect();
    });
  }

  // 断开连接
  disconnect() {
    this.reconnectionManager.stop();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  // 获取状态
  getStatus() {
    return {
      connected: this.isConnected,
      serverUrl: this.serverUrl,
      deviceId: this.hostDeviceId,
      reconnection: this.reconnectionManager.getStatus(),
    };
  }
}

module.exports = HostWebSocketClient;
```

- [ ] **Step 4: 集成到后端服务器**

修改`backend/src/app.js`：

```javascript
// 在文件开头添加
const HostWebSocketClient = require('./websocket/client');

// 在服务器启动后连接WebSocket
const wsClient = new HostWebSocketClient();

// 注册消息处理器
wsClient.onMessage('new_task', (taskInfo) => {
  console.log('[Backend] Processing new task via WebSocket:', taskInfo.taskId);
  // 这里可以触发任务处理流程
  // 例如：调用现有的任务处理函数
});

wsClient.onMessage('task_cancel', (taskId) => {
  console.log('[Backend] Cancelling task via WebSocket:', taskId);
  // 这里可以取消任务
});

// 在服务器启动时连接
server.on('listening', () => {
  wsClient.connect();
});

// 导出wsClient以便其他模块使用
module.exports = { app, server, wsClient };
```

- [ ] **Step 5: 与现有任务处理集成**

修改`backend/src/routes/cloudRelayHost.js`：

```javascript
// 在文件开头添加
const { wsClient } = require('../app');

// 修改 processClaimedV2Tasks 函数，在任务完成时通知WebSocket
async function processClaimedV2Tasks(db, authOptions, dependencies = {}) {
  // ... 原有代码 ...

  for (let count = 0; count < 100; count += 1) {
    const claimed = await claimTask({ hostDeviceId: resolveHostDeviceId(), leaseMs }, authOptions);
    if (!claimed?.success || !claimed.task) break;
    const { task, claimToken } = claimed;
    
    // ... 原有任务处理代码 ...

    try {
      // ... 原有任务处理逻辑 ...

      // 任务完成后通知WebSocket
      if (task.task_type === 'desktop-sync' && wsClient) {
        const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
        wsClient.send({
          type: 'task_complete',
          taskId: task.id,
          taskType: task.task_type,
          deviceId: payload.deviceId,
          result: generatedResult,
          completedAt: new Date().toISOString(),
        });
      }

      // ... 原有完成逻辑 ...
    } catch (error) {
      // ... 原有错误处理 ...
    }
  }
  return results;
}
```

- [ ] **Step 6: 运行测试验证客户端**

Run: `cd backend && npm test`
Expected: 所有测试通过

- [ ] **Step 7: 提交代码**

```bash
git add backend/src/websocket/ backend/src/app.js backend/src/routes/cloudRelayHost.js backend/package.json
git commit -m "feat: 实现数据主机WebSocket客户端"
```

### Task 6: 实现桌面客户端WebSocket客户端

**Files:**
- Create: `src/services/websocketClient.mjs`
- Modify: `src/services/oneClickSyncService.mjs:104-270`
- Modify: `src/services/oneClickSyncTransports.mjs:137-205`

- [ ] **Step 1: 创建桌面客户端WebSocket客户端**

```javascript
// src/services/websocketClient.mjs
class DesktopWebSocketClient {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || '';
    this.deviceId = options.deviceId || '';
    this.sessionResolver = options.sessionResolver;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.messageHandlers = new Map();
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
  }

  // 连接到WebSocket服务器
  async connect() {
    if (!this.serverUrl) {
      console.error('[DesktopWebSocket] Server URL not configured');
      return false;
    }

    try {
      // 获取会话信息
      const session = await this.sessionResolver();
      if (!session?.authorization) {
        console.error('[DesktopWebSocket] No valid session');
        return false;
      }

      // 构建WebSocket URL
      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws/desktop';
      const token = session.authorization.replace('Bearer ', '');

      console.log(`[DesktopWebSocket] Connecting to ${wsUrl}`);

      this.ws = new WebSocket(`${wsUrl}?token=${token}`);

      this.ws.onopen = () => {
        console.log('[DesktopWebSocket] Connected to server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.sendRegistration();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[DesktopWebSocket] Failed to parse message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[DesktopWebSocket] Connection closed: ${event.code} ${event.reason}`);
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[DesktopWebSocket] Connection error:', error);
        this.isConnected = false;
      };

      return true;
    } catch (error) {
      console.error('[DesktopWebSocket] Failed to connect:', error);
      return false;
    }
  }

  // 发送注册消息
  sendRegistration() {
    this.send({
      type: 'register',
      deviceId: this.deviceId,
      role: 'desktop-client',
    });
  }

  // 发送消息
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // 发送请求并等待响应
  sendRequest(message, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeout);

      // 存储请求
      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          reject(error);
        },
        timeout: timeoutId,
      });

      // 发送消息
      this.send({
        ...message,
        requestId,
      });
    });
  }

  // 处理接收到的消息
  handleMessage(message) {
    console.log('[DesktopWebSocket] Received message:', message.type);

    // 检查是否为请求响应
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const pending = this.pendingRequests.get(message.requestId);
      pending.resolve(message);
      return;
    }

    switch (message.type) {
      case 'task_complete':
        this.handleTaskComplete(message.result);
        break;
      case 'task_progress':
        this.handleTaskProgress(message);
        break;
      case 'host_status_update':
        this.handleHostStatusUpdate(message);
        break;
      case 'heartbeat_ack':
        // 心跳确认，无需处理
        break;
      default:
        console.log('[DesktopWebSocket] Unknown message type:', message.type);
    }
  }

  // 处理任务完成
  handleTaskComplete(result) {
    console.log('[DesktopWebSocket] Task completed:', result.taskId);
    
    if (this.messageHandlers.has('task_complete')) {
      this.messageHandlers.get('task_complete')(result);
    }
  }

  // 处理任务进度
  handleTaskProgress(message) {
    console.log('[DesktopWebSocket] Task progress:', message.taskId, message.progress);
    
    if (this.messageHandlers.has('task_progress')) {
      this.messageHandlers.get('task_progress')(message);
    }
  }

  // 处理主机状态更新
  handleHostStatusUpdate(message) {
    console.log('[DesktopWebSocket] Host status update:', message.hostDeviceId, message.status);
    
    if (this.messageHandlers.has('host_status_update')) {
      this.messageHandlers.get('host_status_update')(message);
    }
  }

  // 注册消息处理器
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  // 开始心跳
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.send({
        type: 'heartbeat',
        deviceId: this.deviceId,
        timestamp: Date.now(),
      });
    }, 30000);
  }

  // 停止心跳
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // 安排重连
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[DesktopWebSocket] Max reconnect attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * 0.5 - 0.25;
    const finalDelay = Math.floor(delay * (1 + jitter));

    console.log(`[DesktopWebSocket] Scheduling reconnect in ${finalDelay}ms`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, finalDelay);
  }

  // 断开连接
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  // 获取状态
  getStatus() {
    return {
      connected: this.isConnected,
      serverUrl: this.serverUrl,
      deviceId: this.deviceId,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// 单例实例
let instance = null;

export function getDesktopWebSocketClient(options = {}) {
  if (!instance) {
    instance = new DesktopWebSocketClient(options);
  }
  return instance;
}

export function resetDesktopWebSocketClient() {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}

export default DesktopWebSocketClient;
```

- [ ] **Step 2: 集成到同步服务**

修改`src/services/oneClickSyncService.mjs`：

```javascript
// 在文件开头添加
import { getDesktopWebSocketClient } from './websocketClient.mjs';

// 修改 runOneClickSync 函数，添加WebSocket支持
export async function runOneClickSync(options) {
  const engine = options?.engine;
  const transports = options?.transports || [];
  const confirmPreview = options?.confirmPreview || (async () => true);
  const buildLocalDataMaps = options?.buildLocalDataMaps || (() => ({}));
  const applyLocalDataMaps = options?.applyLocalDataMaps || (() => {});
  const pendingChanges = getPendingChanges(engine);

  // ... 原有代码 ...

  // 尝试使用WebSocket
  const wsClient = getDesktopWebSocketClient();
  if (wsClient.isConnected) {
    console.log('[Sync] Using WebSocket for real-time updates');
    
    // 设置消息处理器
    wsClient.onMessage('task_complete', (result) => {
      console.log('[Sync] Task completed via WebSocket:', result.taskId);
      // 处理任务完成
    });

    wsClient.onMessage('task_progress', (message) => {
      console.log('[Sync] Task progress via WebSocket:', message.progress);
      // 更新进度
    });
  }

  // ... 原有同步逻辑 ...

  // 如果使用云中继且WebSocket已连接，等待实时通知
  if (transport.name === 'cloud' && wsClient.isConnected && queued?.requestId) {
    console.log('[Sync] Waiting for WebSocket notification for task:', queued.requestId);
    
    // 等待WebSocket通知（最多30秒）
    const result = await Promise.race([
      new Promise((resolve) => {
        wsClient.onMessage('task_complete', (message) => {
          if (message.taskId === queued.requestId) {
            resolve(message.result);
          }
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);

    if (result) {
      console.log('[Sync] Task completed via WebSocket');
      // 处理结果
    } else {
      console.log('[Sync] WebSocket timeout, falling back to HTTP polling');
      // 回退到HTTP轮询
    }
  }

  // ... 原有代码 ...
}
```

- [ ] **Step 3: 更新云中继传输层**

修改`src/services/oneClickSyncTransports.mjs`：

```javascript
// 在文件开头添加
import { getDesktopWebSocketClient } from './websocketClient.mjs';

// 修改 createCloudRelaySyncTransport 函数
export function createCloudRelaySyncTransport(options = {}) {
  // ... 原有代码 ...

  return {
    name: 'cloud',
    label: 'Cloud relay',
    queueOnly: true,
    // ... 原有方法 ...

    // 添加WebSocket支持方法
    async waitForRealtimeNotification(requestId, timeout = 30000) {
      const wsClient = getDesktopWebSocketClient();
      if (!wsClient.isConnected) {
        return null;
      }

      return Promise.race([
        new Promise((resolve) => {
          wsClient.onMessage('task_complete', (message) => {
            if (message.taskId === requestId) {
              resolve(message.result);
            }
          });
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
      ]);
    },
  };
}
```

- [ ] **Step 4: 初始化WebSocket客户端**

修改`src/services/desktopSessionRelayClient.mjs`：

```javascript
// 在文件开头添加
import { getDesktopWebSocketClient } from './websocketClient.mjs';

// 在会话建立后初始化WebSocket
export async function initializeDesktopWebSocket(sessionResolver, deviceId, serverUrl) {
  const wsClient = getDesktopWebSocketClient({
    serverUrl,
    deviceId,
    sessionResolver,
  });

  // 连接到WebSocket服务器
  const connected = await wsClient.connect();
  if (connected) {
    console.log('[DesktopSession] WebSocket connected');
  } else {
    console.log('[DesktopSession] WebSocket connection failed, will use HTTP fallback');
  }

  return wsClient;
}
```

- [ ] **Step 5: 运行测试验证客户端**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 6: 提交代码**

```bash
git add src/services/websocketClient.mjs src/services/oneClickSyncService.mjs src/services/oneClickSyncTransports.mjs src/services/desktopSessionRelayClient.mjs
git commit -m "feat: 实现桌面客户端WebSocket客户端"
```

## 阶段4: 集成测试和优化

### Task 7: 集成测试WebSocket通信

**Files:**
- Create: `tests/websocket-integration.test.js`
- Modify: `gateway/src/websocket/server.js`
- Modify: `backend/src/websocket/client.js`
- Modify: `src/services/websocketClient.mjs`

- [ ] **Step 1: 创建WebSocket集成测试**

```javascript
// tests/websocket-integration.test.js
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { CloudWebSocketServer } = require('../gateway/src/websocket/server');
const HostWebSocketClient = require('../backend/src/websocket/client');
const DesktopWebSocketClient = require('../src/services/websocketClient.mjs');

describe('WebSocket Integration Tests', function() {
  let server;
  let wsServer;
  let hostClient;
  let desktopClient;

  before(function(done) {
    // 创建测试服务器
    server = http.createServer();
    wsServer = new CloudWebSocketServer(server);
    
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`Test server listening on port ${port}`);
      done();
    });
  });

  after(function(done) {
    // 清理
    if (hostClient) hostClient.disconnect();
    if (desktopClient) desktopClient.disconnect();
    server.close(done);
  });

  describe('Connection Management', function() {
    it('should allow host to connect', function(done) {
      hostClient = new HostWebSocketClient({
        serverUrl: `http://localhost:${server.address().port}`,
        hostDeviceId: 'test-host-001',
        hostToken: 'test-token',
      });

      hostClient.onMessage('new_task', (task) => {
        assert(task.taskId);
        done();
      });

      hostClient.connect();
    });

    it('should allow desktop client to connect', function(done) {
      desktopClient = new DesktopWebSocketClient({
        serverUrl: `http://localhost:${server.address().port}`,
        deviceId: 'test-desktop-001',
        sessionResolver: async () => ({
          authorization: 'Bearer test-token',
          authContext: { deviceId: 'test-desktop-001' },
        }),
      });

      desktopClient.connect().then(() => {
        assert(desktopClient.isConnected);
        done();
      });
    });
  });

  describe('Message Delivery', function() {
    it('should deliver task notification from host to desktop', function(done) {
      const testTask = {
        taskId: 'task-001',
        taskType: 'desktop-sync',
        deviceId: 'test-desktop-001',
      };

      desktopClient.onMessage('task_complete', (result) => {
        assert.equal(result.taskId, testTask.taskId);
        done();
      });

      // 主机发送任务完成通知
      wsServer.notifyDesktopTaskComplete('test-desktop-001', testTask);
    });

    it('should deliver new task notification from desktop to host', function(done) {
      const testTask = {
        taskId: 'task-002',
        taskType: 'desktop-sync',
      };

      hostClient.onMessage('new_task', (task) => {
        assert.equal(task.taskId, testTask.taskId);
        done();
      });

      // 桌面端提交任务
      wsServer.notifyHostNewTask('test-host-001', testTask);
    });
  });

  describe('Heartbeat', function() {
    it('should handle heartbeat messages', function(done) {
      // 发送心跳
      hostClient.send({
        type: 'heartbeat',
        deviceId: 'test-host-001',
        timestamp: Date.now(),
      });

      // 等待心跳确认
      setTimeout(() => {
        // 心跳确认应该已经收到
        done();
      }, 1000);
    });
  });

  describe('Reconnection', function() {
    it('should reconnect after disconnection', function(done) {
      const testClient = new HostWebSocketClient({
        serverUrl: `http://localhost:${server.address().port}`,
        hostDeviceId: 'test-host-reconnect',
        hostToken: 'test-token',
      });

      let connectCount = 0;
      testClient.onMessage = (type, handler) => {
        if (type === 'new_task') {
          connectCount++;
          if (connectCount >= 2) {
            testClient.disconnect();
            done();
          }
        }
      };

      testClient.connect();
      
      // 模拟断开连接后重连
      setTimeout(() => {
        testClient.disconnect();
        setTimeout(() => {
          testClient.connect();
        }, 1000);
      }, 500);
    });
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npm test tests/websocket-integration.test.js`
Expected: 所有测试通过

- [ ] **Step 3: 修复测试中发现的问题**

根据测试结果修复任何问题。

- [ ] **Step 4: 提交测试代码**

```bash
git add tests/websocket-integration.test.js
git commit -m "test: 添加WebSocket集成测试"
```

### Task 8: 性能优化和监控

**Files:**
- Modify: `gateway/src/websocket/server.js`
- Modify: `backend/src/websocket/client.js`
- Modify: `src/services/websocketClient.mjs`

- [ ] **Step 1: 添加连接池管理**

修改`gateway/src/websocket/connectionManager.js`：

```javascript
// 添加连接池管理
class ConnectionManager {
  constructor() {
    // ... 原有代码 ...
    
    // 连接池配置
    this.connectionPool = {
      maxConnections: 1000,
      cleanupInterval: 60000, // 1分钟清理一次
      idleTimeout: 300000, // 5分钟空闲超时
    };
    
    this.startCleanup();
  }

  // 清理空闲连接
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [deviceId, connection] of this.connections.entries()) {
        if (now - connection.lastHeartbeat > this.connectionPool.idleTimeout) {
          console.log(`[ConnectionManager] Cleaning up idle connection: ${deviceId}`);
          connection.ws.close(1000, 'Idle timeout');
          this.removeConnection(deviceId);
        }
      }
    }, this.connectionPool.cleanupInterval);
  }

  // 检查连接池限制
  canAddConnection() {
    return this.connections.size < this.connectionPool.maxConnections;
  }
}
```

- [ ] **Step 2: 添加性能监控**

修改`gateway/src/websocket/server.js`：

```javascript
// 添加性能监控
class CloudWebSocketServer {
  constructor(server) {
    // ... 原有代码 ...
    
    // 性能指标
    this.metrics = {
      connectionsTotal: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      averageLatency: 0,
      latencySum: 0,
      latencyCount: 0,
    };
    
    this.startMetricsCollection();
  }

  // 收集性能指标
  startMetricsCollection() {
    setInterval(() => {
      console.log('[WebSocket Metrics]', {
        connections: this.connectionManager.getStats(),
        messages: {
          sent: this.metrics.messagesSent,
          received: this.metrics.messagesReceived,
          errors: this.metrics.errors,
        },
        latency: {
          average: this.metrics.latencyCount > 0 ? this.metrics.latencySum / this.metrics.latencyCount : 0,
          count: this.metrics.latencyCount,
        },
      });
    }, 60000); // 每分钟输出一次
  }

  // 记录消息发送
  trackMessageSent() {
    this.metrics.messagesSent++;
  }

  // 记录消息接收
  trackMessageReceived() {
    this.metrics.messagesReceived++;
  }

  // 记录延迟
  trackLatency(latency) {
    this.metrics.latencySum += latency;
    this.metrics.latencyCount++;
    this.metrics.averageLatency = this.metrics.latencySum / this.metrics.latencyCount;
  }

  // 记录错误
  trackError() {
    this.metrics.errors++;
  }
}
```

- [ ] **Step 3: 添加消息确认机制**

修改`gateway/src/websocket/server.js`：

```javascript
// 添加消息确认机制
class CloudWebSocketServer {
  constructor(server) {
    // ... 原有代码 ...
    
    // 消息确认配置
    this.ackConfig = {
      enabled: true,
      timeout: 5000, // 5秒确认超时
      maxRetries: 3,
    };
    
    this.pendingAcks = new Map(); // messageId -> { resolve, reject, timeout }
  }

  // 发送需要确认的消息
  sendWithAck(deviceId, message, timeout = this.ackConfig.timeout) {
    return new Promise((resolve, reject) => {
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingAcks.delete(messageId);
        reject(new Error('Message ACK timeout'));
      }, timeout);

      // 存储待确认消息
      this.pendingAcks.set(messageId, {
        resolve: (response) => {
          clearTimeout(timeoutId);
          this.pendingAcks.delete(messageId);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingAcks.delete(messageId);
          reject(error);
        },
        timeout: timeoutId,
        retries: 0,
      });

      // 发送消息
      const sent = this.connectionManager.sendToDevice(deviceId, {
        ...message,
        messageId,
        requiresAck: this.ackConfig.enabled,
      });

      if (!sent) {
        clearTimeout(timeoutId);
        this.pendingAcks.delete(messageId);
        reject(new Error('Device not connected'));
      }
    });
  }

  // 处理消息确认
  handleAck(messageId, response) {
    if (this.pendingAcks.has(messageId)) {
      const pending = this.pendingAcks.get(messageId);
      pending.resolve(response);
    }
  }
}
```

- [ ] **Step 4: 运行性能测试**

创建性能测试脚本：

```javascript
// tests/websocket-performance.test.js
const assert = require('assert');
const http = require('http');
const { CloudWebSocketServer } = require('../gateway/src/websocket/server');
const HostWebSocketClient = require('../backend/src/websocket/client');

describe('WebSocket Performance Tests', function() {
  let server;
  let wsServer;
  const clients = [];

  before(function(done) {
    server = http.createServer();
    wsServer = new CloudWebSocketServer(server);
    
    server.listen(0, done);
  });

  after(function(done) {
    clients.forEach(client => client.disconnect());
    server.close(done);
  });

  it('should handle multiple concurrent connections', function(done) {
    const clientCount = 100;
    let connectedCount = 0;

    for (let i = 0; i < clientCount; i++) {
      const client = new HostWebSocketClient({
        serverUrl: `http://localhost:${server.address().port}`,
        hostDeviceId: `test-host-${i}`,
        hostToken: 'test-token',
      });

      client.connect().then(() => {
        connectedCount++;
        clients.push(client);
        
        if (connectedCount === clientCount) {
          const stats = wsServer.getStats();
          assert.equal(stats.totalConnections, clientCount);
          done();
        }
      });
    }
  });

  it('should handle high message throughput', function(done) {
    const messageCount = 1000;
    let receivedCount = 0;
    const startTime = Date.now();

    const client = clients[0];
    client.onMessage('task_complete', () => {
      receivedCount++;
      if (receivedCount === messageCount) {
        const duration = Date.now() - startTime;
        console.log(`Processed ${messageCount} messages in ${duration}ms`);
        console.log(`Average: ${duration / messageCount}ms per message`);
        done();
      }
    });

    // 发送大量消息
    for (let i = 0; i < messageCount; i++) {
      wsServer.notifyDesktopTaskComplete('test-host-0', {
        taskId: `task-${i}`,
        message: `Message ${i}`,
      });
    }
  });
});
```

- [ ] **Step 5: 运行性能测试**

Run: `npm test tests/websocket-performance.test.js`
Expected: 性能指标达到预期

- [ ] **Step 6: 提交优化代码**

```bash
git add gateway/src/websocket/ backend/src/websocket/ src/services/websocketClient.mjs tests/websocket-performance.test.js
git commit -m "perf: 优化WebSocket性能和监控"
```

### Task 9: 文档和部署配置

**Files:**
- Create: `docs/websocket-deployment.md`
- Create: `docs/websocket-api.md`
- Modify: `gateway/src/websocket/server.js`
- Modify: `backend/src/websocket/client.js`

- [ ] **Step 1: 创建部署文档**

```markdown
# WebSocket 云中继部署指南

## 架构概述

WebSocket 云中继用于实现桌面端与数据主机之间的实时通信，替代原有的长轮询模式，将同步延迟从1-2分钟降低到1-3秒。

## 组件说明

### WebSocket服务器 (Gateway)
- 位置：`gateway/src/websocket/`
- 功能：管理所有WebSocket连接，转发消息
- 依赖：ws, jsonwebtoken

### 数据主机客户端 (Backend)
- 位置：`backend/src/websocket/`
- 功能：连接云端WebSocket服务器，接收任务通知
- 依赖：ws

### 桌面客户端
- 位置：`src/services/websocketClient.mjs`
- 功能：连接云端WebSocket服务器，接收任务结果
- 依赖：原生WebSocket API

## 部署步骤

### 1. 安装依赖

```bash
# Gateway
cd gateway && npm install

# Backend
cd backend && npm install
```

### 2. 配置环境变量

```bash
# Gateway
WECHAT_APPID=your_appid
JWT_SECRET=your_jwt_secret
GEWU_CLOUD_RELAY_HOST_TOKEN=your_host_token

# Backend
GEWU_CLOUD_BASE_URL=https://your-gateway-url
GEWU_DEVICE_ID=your_host_device_id
GEWU_CLOUD_RELAY_HOST_TOKEN=your_host_token
```

### 3. 启动服务

```bash
# 启动Gateway (包含WebSocket服务器)
cd gateway && npm start

# 启动Backend (包含WebSocket客户端)
cd backend && npm start
```

### 4. 验证连接

```bash
# 检查WebSocket服务器状态
curl http://localhost:PORT/api/websocket/status

# 检查WebSocket客户端状态
curl http://localhost:BACKEND_PORT/api/websocket/status
```

## 监控和日志

### 性能指标
- 连接数：监控同时连接的设备数量
- 消息吞吐量：监控每秒消息处理量
- 延迟：监控消息传递延迟
- 错误率：监控连接错误和消息处理错误

### 日志级别
- INFO：连接建立/断开、任务通知
- WARN：重连尝试、超时
- ERROR：连接失败、消息处理错误

## 故障排除

### 连接失败
1. 检查网络连接
2. 验证Token是否有效
3. 检查防火墙设置
4. 查看服务器日志

### 消息延迟
1. 检查网络延迟
2. 监控服务器负载
3. 检查消息队列状态

### 重连频繁
1. 检查网络稳定性
2. 调整重连参数
3. 检查服务器负载

## 回滚方案

如果WebSocket出现问题，可以回退到HTTP轮询模式：

1. 禁用WebSocket客户端
2. 启用HTTP轮询模式
3. 验证功能正常

## 性能优化建议

1. **连接池管理**：限制最大连接数，清理空闲连接
2. **消息压缩**：启用WebSocket消息压缩
3. **负载均衡**：多实例部署时使用负载均衡
4. **监控告警**：设置性能指标告警
```

- [ ] **Step 2: 创建API文档**

```markdown
# WebSocket API 文档

## 连接信息

### WebSocket服务器端点
```
ws://{host}:{port}/ws/host  # 数据主机连接
ws://{host}:{port}/ws/desktop  # 桌面客户端连接
```

### 认证方式
使用JWT Token进行认证：
```
ws://{host}:{port}/ws/host?token={jwt_token}
ws://{host}:{port}/ws/desktop?token={jwt_token}
```

## 消息格式

### 通用消息结构
```json
{
  "type": "message_type",
  "messageId": "unique_message_id",
  "timestamp": 1234567890,
  "requiresAck": true,
  "data": {}
}
```

### 消息类型

#### 1. 注册消息 (register)
**方向**：客户端 → 服务器

```json
{
  "type": "register",
  "deviceId": "device-001",
  "role": "primary-host",
  "capabilities": ["task-processing", "sync"]
}
```

#### 2. 心跳消息 (heartbeat)
**方向**：客户端 ↔ 服务器

```json
{
  "type": "heartbeat",
  "deviceId": "device-001",
  "timestamp": 1234567890
}
```

**响应**：
```json
{
  "type": "heartbeat_ack",
  "serverTime": 1234567890
}
```

#### 3. 新任务通知 (new_task)
**方向**：服务器 → 数据主机

```json
{
  "type": "new_task",
  "task": {
    "taskId": "task-001",
    "taskType": "desktop-sync",
    "deviceId": "desktop-001",
    "createdAt": "2026-07-25T00:00:00Z"
  },
  "timestamp": 1234567890
}
```

#### 4. 任务完成通知 (task_complete)
**方向**：服务器 → 桌面客户端

```json
{
  "type": "task_complete",
  "result": {
    "taskId": "task-001",
    "taskType": "desktop-sync",
    "status": "completed",
    "applied": 5,
    "conflicts": 0,
    "completedAt": "2026-07-25T00:00:05Z"
  },
  "timestamp": 1234567890
}
```

#### 5. 任务进度通知 (task_progress)
**方向**：服务器 → 桌面客户端

```json
{
  "type": "task_progress",
  "taskId": "task-001",
  "progress": 50,
  "phase": "processing",
  "timestamp": 1234567890
}
```

#### 6. 主机状态更新 (host_status_update)
**方向**：服务器 → 桌面客户端

```json
{
  "type": "host_status_update",
  "hostDeviceId": "host-001",
  "status": "online",
  "timestamp": 1234567890
}
```

#### 7. 消息确认 (ack)
**方向**：接收方 → 发送方

```json
{
  "type": "ack",
  "messageId": "msg-001",
  "success": true,
  "data": {}
}
```

## 错误处理

### 错误消息格式
```json
{
  "type": "error",
  "code": "ERROR_CODE",
  "message": "Error description",
  "messageId": "msg-001"
}
```

### 常见错误码

| 错误码 | 说明 |
|--------|------|
| AUTH_FAILED | 认证失败 |
| DEVICE_NOT_FOUND | 设备未注册 |
| TASK_NOT_FOUND | 任务不存在 |
| MESSAGE_TIMEOUT | 消息超时 |
| CONNECTION_CLOSED | 连接关闭 |

## 重连策略

客户端断开连接后，使用指数退避策略重连：

1. 基础延迟：1秒
2. 最大延迟：30秒
3. 最大尝试次数：10次
4. 随机抖动：±25%

## 性能优化

1. **消息压缩**：启用permessage-deflate扩展
2. **连接池**：限制最大连接数，清理空闲连接
3. **批量处理**：合并多个小消息
4. **负载均衡**：多实例部署时使用负载均衡
```

- [ ] **Step 3: 添加配置选项**

修改`gateway/src/websocket/server.js`：

```javascript
// 添加配置选项
class CloudWebSocketServer {
  constructor(server, options = {}) {
    this.config = {
      // 连接配置
      maxConnections: options.maxConnections || 1000,
      heartbeatInterval: options.heartbeatInterval || 30000,
      heartbeatTimeout: options.heartbeatTimeout || 60000,
      
      // 消息配置
      enableCompression: options.enableCompression !== false,
      maxMessageSize: options.maxMessageSize || 1024 * 1024, // 1MB
      
      // 性能配置
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 60000,
      
      // 安全配置
      enableAck: options.enableAck !== false,
      ackTimeout: options.ackTimeout || 5000,
      
      // ... 原有代码 ...
    };
    
    // ... 原有代码 ...
  }
}
```

- [ ] **Step 4: 添加健康检查端点**

修改`gateway/src/app.js`：

```javascript
// 添加WebSocket健康检查
app.get('/api/websocket/status', (req, res) => {
  const wsServer = app.get('wsServer');
  if (!wsServer) {
    return res.json({ success: false, error: 'WebSocket server not initialized' });
  }

  const stats = wsServer.getStats();
  res.json({
    success: true,
    status: 'healthy',
    connections: stats,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
```

- [ ] **Step 5: 提交文档和配置**

```bash
git add docs/websocket-deployment.md docs/websocket-api.md gateway/src/websocket/server.js backend/src/websocket/client.js gateway/src/app.js
git commit -m "docs: 添加WebSocket部署和API文档"
```

### Task 10: 最终验证和清理

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: 运行完整测试套件**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 2: 运行代码检查**

Run: `npm run lint`
Expected: 没有错误

- [ ] **Step 3: 更新package.json**

修改根目录`package.json`：

```json
{
  "scripts": {
    "test": "jest",
    "test:websocket": "jest tests/websocket-*.test.js",
    "lint": "eslint .",
    "start:gateway": "cd gateway && npm start",
    "start:backend": "cd backend && npm start"
  }
}
```

- [ ] **Step 4: 更新README.md**

在README.md中添加WebSocket相关说明：

```markdown
## WebSocket 云中继

本项目使用WebSocket实现实时通信，替代原有的长轮询模式。

### 特性
- 实时任务通知
- 自动重连机制
- HTTP降级支持
- 性能监控

### 文档
- [部署指南](docs/websocket-deployment.md)
- [API文档](docs/websocket-api.md)
```

- [ ] **Step 5: 清理临时文件**

```bash
# 删除临时测试文件
rm -f tests/temp-*.js

# 清理日志文件
rm -f *.log
```

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "chore: 完成WebSocket云中继实现"
```

## 完成检查

### 功能验证
- [ ] WebSocket服务器正常启动
- [ ] 数据主机可以连接并接收任务通知
- [ ] 桌面客户端可以连接并接收任务结果
- [ ] HTTP降级正常工作
- [ ] 自动重连机制正常

### 性能验证
- [ ] 连接延迟 < 100ms
- [ ] 消息延迟 < 1s
- [ ] 支持100+并发连接
- [ ] 内存使用稳定

### 代码质量
- [ ] 所有测试通过
- [ ] 代码检查无错误
- [ ] 文档完整
- [ ] 无重复代码

### 部署验证
- [ ] Gateway部署成功
- [ ] Backend部署成功
- [ ] 环境变量配置正确
- [ ] 监控和日志正常
