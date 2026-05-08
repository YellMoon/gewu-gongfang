/**
 * 认证路由（微信小程序登录预留）
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { generateToken, JWT_SECRET } = require('../middleware/auth');

const router = Router();

/**
 * POST /api/auth/wechat-login
 * 微信小程序登录
 * 
 * Body: { code: "微信登录code" }
 * Response: { token: "jwt...", user: { id, nickname, ... } }
 */
router.post('/wechat-login', async (req, res) => {
  try {
    const { code, userInfo } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: '缺少登录code' });
    }

    // TODO: 调用微信接口换取 openid
    // const wxResult = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
    //   params: {
    //     appid: process.env.WECHAT_APPID,
    //     secret: process.env.WECHAT_APPSECRET,
    //     js_code: code,
    //     grant_type: 'authorization_code'
    //   }
    // });
    // const { openid, unionid } = wxResult.data;

    // 开发阶段使用模拟数据
    const openid = 'dev_' + (code || 'mock').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    const unionid = null;
    const nickname = userInfo?.nickName || '管理员';
    const avatarUrl = userInfo?.avatarUrl || null;

    const db = getInstance();
    const user = db.findOrCreateUserByWechat(openid, unionid, nickname, avatarUrl);
    const token = generateToken(user);

    res.json({
      success: true,
      data: {
        token,
        userId: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息（需认证）
 */
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.json({ success: false, error: '未登录' });
  }
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    res.json({ success: true, data: decoded });
  } catch {
    res.json({ success: false, error: 'Token无效' });
  }
});

module.exports = router;
