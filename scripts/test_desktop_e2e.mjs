#!/usr/bin/env node
/**
 * 端到端测试：模拟普通桌面端 ↔ 数据主机
 * 测试设备绑定和数据同步的完整流程
 * 
 * 运行方式：node scripts/test_desktop_e2e.mjs
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3003';  // 测试 Gateway
const HOST_TOKEN = process.env.HOST_TOKEN || '2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec';
const HOST_DEVICE_ID = 'primary-host';

// Import shared logic for canonicalResultJson and resultHash
const { resultHash: sharedResultHash, stableValue } = await import('../shared/cloudRelayLogic.js');

const results = [];
function test(name, passed, detail = '') {
  const status = passed ? 'PASS' : 'FAIL';
  results.push({ name, passed, detail });
  console.log(`  [${status}] ${name}` + (detail ? ` (${detail})` : ''));
}

async function httpGet(url, headers = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json() };
}

async function httpPost(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log('='.repeat(70));
  console.log('端到端测试：模拟普通桌面端 ↔ 数据主机');
  console.log('='.repeat(70));

  // ============================================================
  // 阶段一：基础设施
  // ============================================================
  console.log('\n--- 阶段一：基础设施 ---');

  const gwHealth = await httpGet(`${GATEWAY}/api/health`);
  test('Gateway 健康', gwHealth.body.ok, `v${gwHealth.body.version}`);

  // ============================================================
  // 阶段二：主机心跳（注册到 Gateway）
  // ============================================================
  console.log('\n--- 阶段二：主机心跳 ---');

  const heartbeat = await httpPost(`${GATEWAY}/api/cloud/host/heartbeat`, {
    hostDeviceId: HOST_DEVICE_ID,
    lanUrls: ['http://127.0.0.1:3002'],
    status: 'online',
  }, { 'x-gewu-host-token': HOST_TOKEN });
  test('主机心跳', heartbeat.body.success, JSON.stringify(heartbeat.body));

  // ============================================================
  // 阶段三：主机发布配对能力
  // ============================================================
  console.log('\n--- 阶段三：发布配对能力 ---');

  // 生成配对能力参数
  const capabilityId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10分钟后过期

  const capability = await httpPost(`${GATEWAY}/api/cloud/desktop-pairing/capability`, {
    hostDeviceId: HOST_DEVICE_ID,
    epochId: `epoch-${Date.now()}`,
    generation: 1,
    capability: {
      protocolVersion: 'gewu-single-user-pairing/v1',
      id: capabilityId,
      publicKey: 'dGVzdC1wdWJsaWMta2V5LWZvci10ZXN0aW5n', // base64 test key
      expiresAt,
    },
  }, { 'x-gewu-host-token': HOST_TOKEN });
  test('发布配对能力', capability.body.success, `capabilityId=${capabilityId}`);

  // ============================================================
  // 阶段四：桌面端发现配对能力
  // ============================================================
  console.log('\n--- 阶段四：桌面端发现配对能力 ---');

  const discover = await httpGet(`${GATEWAY}/api/cloud/desktop-pairing/capability`);
  test('发现配对能力', discover.body.success, JSON.stringify(discover.body.capability || {}).substring(0, 80));

  if (!discover.body.success) {
    console.log('\n配对能力未找到，跳过后续测试');
    printResults();
    return;
  }

  const remoteCap = discover.body.capability;

  // ============================================================
  // 阶段五：桌面端提交配对请求
  // ============================================================
  console.log('\n--- 阶段五：桌面端提交配对请求 ---');

  // 生成 requestSecret 并哈希
  const requestSecret = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  const { createHash } = await import('crypto');
  const requestSecretHash = createHash('sha256').update(requestSecret).digest('hex');

  // 模拟加密信封（实际需要加密，这里用假数据测试格式）
  const envelope = {
    protocolVersion: 'gewu-single-user-pairing/v1',
    capabilityId: remoteCap.id,
    clientEphemeralPublicKey: 'dGVzdC1jbGllbnQtZWBoZW1lcmFsLWtleQ==', // base64
    iv: 'dGVzdC1pdiA=', // base64 (8-64 chars)
    ciphertext: 'dGVzdC1jaXBoZXJ0ZXh0LWRhdGEtZm9yLXRlc3Rpbmc=', // base64
    tag: 'dGVzdC10YWc=', // base64 (8-64 chars)
  };

  const pairingRequest = await httpPost(`${GATEWAY}/api/cloud/desktop-pairing/requests`, {
    envelope,
    requestSecretHash,
  });
  test('提交配对请求', pairingRequest.body.success, `requestId=${pairingRequest.body.request?.id}`);

  const pairingRequestId = pairingRequest.body.request?.id;
  if (!pairingRequestId) {
    console.log('\n配对请求失败，跳过后续测试');
    printResults();
    return;
  }

  // ============================================================
  // 阶段六：主机认领并处理配对任务
  // ============================================================
  console.log('\n--- 阶段六：主机处理配对任务 ---');

  // V2 任务用 POST /tasks/claim 认领
  const claim = await httpPost(`${GATEWAY}/api/cloud/tasks/claim`, {
    hostDeviceId: HOST_DEVICE_ID,
    leaseMs: 60000,
  }, { 'x-gewu-host-token': HOST_TOKEN });
  test('认领任务', claim.body.success, JSON.stringify(claim.body).substring(0, 100));

  const claimedTask = claim.body.task;
  if (claimedTask && claimedTask.task_type === 'desktop-pairing') {
    test('找到配对任务', true, `taskId=${claimedTask.id}`);

    // 主机完成任务（模拟处理结果）
    const result = {
      authorization: 'test-authorization-token-for-desktop',
      profile: {
        userId: 'user-001',
        name: '测试用户',
        role: 'teacher',
      },
      offlineLease: {
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };

    // V2 任务需要 operationId, resultHash, claimToken, expectedRowVersion
    const operationId = `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const resultHash = sharedResultHash(result);

    const complete = await httpPost(`${GATEWAY}/api/cloud/tasks/${claimedTask.id}/complete`, {
      operationId,
      resultHash,
      result,
      claimToken: claim.body.claimToken,
      expectedRowVersion: claimedTask.row_version,
    }, { 'x-gewu-host-token': HOST_TOKEN });
    test('完成配对任务', complete.body.success, JSON.stringify(complete.body).substring(0, 100));
  } else {
    test('找到配对任务', false, claimedTask ? `type=${claimedTask.task_type}` : '无任务');
  }

  // ============================================================
  // 阶段七：桌面端查询配对结果
  // ============================================================
  console.log('\n--- 阶段七：桌面端查询配对结果 ---');

  const pairingResult = await httpGet(`${GATEWAY}/api/cloud/desktop-pairing/requests/${pairingRequestId}`, {
    'x-pairing-request-secret': requestSecret,
  });
  test('查询配对结果', pairingResult.body.success);

  if (pairingResult.body.request?.status === 'completed') {
    const auth = pairingResult.body.request.result;
    test('获得授权', !!auth?.authorization, `auth=${auth?.authorization?.substring(0, 20)}...`);
    test('获得用户资料', !!auth?.profile?.userId);
    test('获得离线租约', !!auth?.offlineLease?.expiresAt);

    // ============================================================
    // 阶段八：桌面端使用授权进行数据同步
    // ============================================================
    console.log('\n--- 阶段八：数据同步 ---');

    // 模拟桌面端提交同步请求（通过任务系统）
    const syncTask = await httpPost(`${GATEWAY}/api/cloud/tasks`, {
      taskType: 'desktop-sync',
      payload: {
        deviceId: 'test-desktop-001',
        pendingChanges: [
          { action: 'update', table: 'students', id: 1, data: { name: '同步测试姓名' } },
          { action: 'create', table: 'exams', id: 'new-001', data: { title: '同步测试考试' } },
        ],
      },
    }, { 'x-gewu-host-token': HOST_TOKEN });
    test('创建同步任务', syncTask.body.success, `taskId=${syncTask.body.task?.id}`);

    if (syncTask.body.success) {
      const syncTaskId = syncTask.body.task.id;

      // 主机认领同步任务
      const syncClaim = await httpPost(`${GATEWAY}/api/cloud/tasks/claim`, {
        hostDeviceId: HOST_DEVICE_ID,
        leaseMs: 60000,
      }, { 'x-gewu-host-token': HOST_TOKEN });
      test('认领同步任务', syncClaim.body.success);

      if (syncClaim.body.task) {
        // 主机完成同步任务
        const syncResult = { applied: 2, conflicts: 0, timestamp: new Date().toISOString() };
        const syncOperationId = `sync-op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const syncResultHash = sharedResultHash(syncResult);

        const syncComplete = await httpPost(`${GATEWAY}/api/cloud/tasks/${syncClaim.body.task.id}/complete`, {
          operationId: syncOperationId,
          resultHash: syncResultHash,
          result: syncResult,
          claimToken: syncClaim.body.claimToken,
          expectedRowVersion: syncClaim.body.task.row_version,
        }, { 'x-gewu-host-token': HOST_TOKEN });
        test('完成同步任务', syncComplete.body.success);

        // 查询同步结果
        const syncResultResp = await httpGet(`${GATEWAY}/api/cloud/tasks/${syncClaim.body.task.id}/result`);
        test('查询同步结果', syncResultResp.body.success || !!syncResultResp.body.result);
      } else {
        test('认领同步任务', false, '无任务');
      }
    }
  }

  // ============================================================
  // 阶段九：WebSocket 连接测试
  // ============================================================
  console.log('\n--- 阶段九：WebSocket 连接 ---');

  // 动态导入 WebSocket
  let WebSocket;
  try {
    const wsModule = await import('ws');
    WebSocket = wsModule.default || wsModule;
  } catch {
    console.log('  ws 模块不可用，跳过 WebSocket 测试');
  }

  if (WebSocket) {
    // 测试主机 WebSocket 连接
    const hostWsResult = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:3003/ws/cloud-relay?token=${HOST_TOKEN}&deviceId=${HOST_DEVICE_ID}&role=host`);
      const messages = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg.type);
        if (msg.type === 'connected') {
          ws.close();
          resolve({ ok: true, messages });
        }
      });
      ws.on('error', (e) => resolve({ ok: false, error: e.message }));
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 5000);
    });
    test('主机 WebSocket 连接', hostWsResult.ok, hostWsResult.messages?.join(','));
  }

  printResults();
}

function printResults() {
  console.log('\n' + '='.repeat(70));
  console.log('测试结果汇总');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.name}` + (r.detail ? ` (${r.detail})` : ''));
  }

  console.log(`\n总计: ${passed}/${results.length} 通过, ${failed} 失败`);

  if (failed === 0) {
    console.log('\n🎉 全部通过！普通桌面端和数据主机可以正常连通！');
  } else {
    console.log(`\n⚠️  ${failed} 个测试需要关注`);
  }
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
