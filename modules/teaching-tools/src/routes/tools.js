/**
 * 教学工具模块 — 插件注册 API
 *
 * GET    /tools              → 获取所有已注册插件（小程序端调用）
 * POST   /tools/sync         → 桌面端同步插件清单到服务器
 * GET    /tools/:id          → 获取单个插件详情 + 参数 schema
 * DELETE /tools/:id          → 管理员删除/下架插件
 * GET    /tools/:id/schema   → 获取插件参数 schema（小程序渲染表单用）
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { executeTool } = require('../engine');

/**
 * GET /tools — 获取所有活跃插件列表（含参数 schema）
 * 小程序端调用 → 拉取工具列表 + 参数定义
 */
router.get('/', (req, res) => {
  try {
    const tools = db.getActiveTools();
    res.json({
      code: 0,
      data: {
        total: tools.length,
        tools,
      },
    });
  } catch (err) {
    console.error('[TeachingTools] 获取插件列表失败:', err);
    res.status(500).json({ code: -1, error: '获取插件列表失败', detail: err.message });
  }
});

/**
 * POST /tools/sync — 桌面端批量同步插件清单
 * Body: { tools: PluginManifest[], source: string }
 */
router.post('/sync', (req, res) => {
  try {
    const { tools, source } = req.body;

    if (!Array.isArray(tools)) {
      return res.status(400).json({ code: -1, error: 'tools 必须是数组' });
    }

    const results = db.syncPlugins(tools, source || 'desktop');

    res.json({
      code: 0,
      data: {
        total: tools.length,
        registered: results.filter(r => r.action === 'registered').length,
        updated: results.filter(r => r.action === 'updated').length,
        skipped: results.filter(r => r.action === 'skipped').length,
        details: results,
      },
    });
  } catch (err) {
    console.error('[TeachingTools] 同步插件失败:', err);
    res.status(500).json({ code: -1, error: '同步插件失败', detail: err.message });
  }
});

/**
 * GET /tools/:id — 获取单个插件详情
 */
router.get('/:id', (req, res) => {
  try {
    const tool = db.getToolById(req.params.id);
    if (!tool) {
      return res.status(404).json({ code: -1, error: '插件不存在或已下架' });
    }
    res.json({ code: 0, data: tool });
  } catch (err) {
    console.error('[TeachingTools] 获取插件详情失败:', err);
    res.status(500).json({ code: -1, error: '获取插件详情失败', detail: err.message });
  }
});

/**
 * GET /tools/:id/schema — 获取插件参数 schema（供小程序渲染配置表单）
 */
router.get('/:id/schema', (req, res) => {
  try {
    const tool = db.getToolById(req.params.id);
    if (!tool) {
      return res.status(404).json({ code: -1, error: '插件不存在或已下架' });
    }

    // 只返回小程序端需要的信息：id、name、parameters schema、platform.miniprogram
    const schema = {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      icon: tool.icon,
      miniprogramMode: tool.platform?.miniprogram || 'none',
      parameters: tool.parameters,
    };

    res.json({ code: 0, data: schema });
  } catch (err) {
    console.error('[TeachingTools] 获取插件参数 schema 失败:', err);
    res.status(500).json({ code: -1, error: '获取参数 schema 失败', detail: err.message });
  }
});

/**
 * DELETE /tools/:id — 管理员下架插件
 */
router.delete('/:id', (req, res) => {
  try {
    const removed = db.removeTool(req.params.id);
    if (!removed) {
      return res.status(404).json({ code: -1, error: '插件不存在' });
    }
    res.json({ code: 0, data: { id: req.params.id, status: 'removed' } });
  } catch (err) {
    console.error('[TeachingTools] 删除插件失败:', err);
    res.status(500).json({ code: -1, error: '删除插件失败', detail: err.message });
  }
});

/**
 * POST /tools/:id/execute — 执行插件（小程序端调用）
 * 接收参数 → 调用对应的渲染引擎 → 返回结果
 *
 * 注意：当前为 stub 实现，完整的服务端渲染引擎将在 V2.0.0 实现
 * 目前返回参数确认信息，前端可据此展示参数配置状态
 */
router.post('/:id/execute', (req, res) => {
  try {
    const tool = db.getToolById(req.params.id);
    if (!tool) {
      return res.status(404).json({ code: -1, error: '插件不存在或已下架' });
    }

    const { params } = req.body;

    // 验证参数
    if (tool.parameters?.required) {
      const missing = tool.parameters.required.filter(function(k) { return !(k in (params || {})); });
      if (missing.length > 0) {
        return res.status(400).json({
          code: -1,
          error: `缺少必要参数: ${missing.join(', ')}`,
        });
      }
    }

    // 调用渲染引擎执行
    const result = executeTool(tool.id, params || {});
    if (result.code !== 0) {
      return res.status(500).json({ code: -1, error: result.error });
    }

    res.json({
      code: 0,
      data: {
        tool: tool.id,
        version: tool.version,
        status: 'ok',
        result: result.data,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[TeachingTools] 执行插件失败:', err);
    res.status(500).json({ code: -1, error: '执行插件失败', detail: err.message });
  }
});

module.exports = router;
