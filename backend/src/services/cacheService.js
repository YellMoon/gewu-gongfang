class CacheService {
  constructor() {
    this.memory = new Map();
    this.redis = null;
    this.ready = false;
    this.connecting = null;
    this.usingRedis = false;
  }

  async connect() {
    if (this.ready) return this;
    if (this.connecting) return this.connecting;

    this.connecting = this.connectRedis()
      .catch((err) => {
        console.warn('[Cache] Redis unavailable, fallback to memory:', err.message);
      })
      .finally(() => {
        this.ready = true;
        this.connecting = null;
      })
      .then(() => this);

    return this.connecting;
  }

  async connectRedis() {
    if (!process.env.REDIS_URL) return;

    const redis = require('redis');
    const client = redis.createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: false,
      },
    });
    client.on('error', (err) => {
      console.warn('[Cache] Redis error:', err.message);
    });

    await client.connect();
    this.redis = client;
    this.usingRedis = true;
    console.info('[Cache] Redis connected');
  }

  disableRedis() {
    if (this.redis) {
      const client = this.redis;
      client
        .quit()
        .catch(() => client.disconnect().catch(() => {}));
    }
    this.redis = null;
    this.usingRedis = false;
  }

  async get(key) {
    await this.connect();
    if (this.redis) {
      try {
        const value = await this.redis.get(key);
        return value ? JSON.parse(value) : null;
      } catch (err) {
        console.warn('[Cache] Redis get failed, fallback to memory:', err.message);
        this.disableRedis();
      }
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
      try {
        await this.redis.set(key, JSON.stringify(value), ttlSeconds > 0 ? { EX: ttlSeconds } : undefined);
        return;
      } catch (err) {
        console.warn('[Cache] Redis set failed, fallback to memory:', err.message);
        this.disableRedis();
      }
    }
    this.memory.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key) {
    await this.connect();
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (err) {
        console.warn('[Cache] Redis del failed, fallback to memory:', err.message);
        this.disableRedis();
      }
    }
    this.memory.delete(key);
  }

  async getKnowledgeRollups() {
    return this.get('knowledge_point_rollups');
  }

  async setKnowledgeRollups(rows, ttlSeconds = 600) {
    return this.set('knowledge_point_rollups', rows, ttlSeconds);
  }
}

module.exports = new CacheService();
