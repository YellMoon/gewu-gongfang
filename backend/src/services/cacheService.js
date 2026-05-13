class CacheService {
  constructor() {
    this.memory = new Map();
    this.redis = null;
    this.ready = false;
  }

  async connect() {
    if (this.ready) return this;
    if (process.env.REDIS_URL) {
      try {
        const redis = require('redis');
        this.redis = redis.createClient({ url: process.env.REDIS_URL });
        this.redis.on('error', (err) => console.warn('[Cache] Redis error:', err.message));
        await this.redis.connect();
      } catch (err) {
        console.warn('[Cache] Redis unavailable, fallback to memory:', err.message);
        this.redis = null;
      }
    }
    this.ready = true;
    return this;
  }

  async get(key) {
    await this.connect();
    if (this.redis) {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    }
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt && hit.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key, value, ttlSeconds = 300) {
    await this.connect();
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    }
    this.memory.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key) {
    await this.connect();
    if (this.redis) await this.redis.del(key);
    this.memory.delete(key);
  }
}

module.exports = new CacheService();
