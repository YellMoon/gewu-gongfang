const { v4: uuidv4 } = require('uuid');

function now() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

class EventBus {
  constructor() {
    this.maxAttempts = Math.max(1, Number(process.env.EVENT_BUS_MAX_ATTEMPTS) || 5);
    this.batchSize = Math.max(1, Number(process.env.EVENT_BUS_BATCH_SIZE) || 100);
  }

  ensureSchema(db) {
    const columns = db.prepare('PRAGMA table_info(outbox_events)').all().map(row => row.name);
    const addColumn = (name, sql) => {
      if (!columns.includes(name)) db.prepare(`ALTER TABLE outbox_events ADD COLUMN ${sql}`).run();
    };
    addColumn('max_attempts', `max_attempts INTEGER DEFAULT ${this.maxAttempts}`);
    addColumn('next_attempt_at', 'next_attempt_at TEXT');
    addColumn('locked_at', 'locked_at TEXT');
    addColumn('last_attempt_at', 'last_attempt_at TEXT');
    addColumn('error_message', 'error_message TEXT');
  }

  publish(db, topic, aggregateType, aggregateId, payload = {}, tenantId = 'default') {
    this.ensureSchema(db);
    const ts = now();
    const event = {
      id: uuidv4(),
      tenant_id: tenantId,
      topic,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      payload: JSON.stringify(payload),
      status: 'pending',
      retry_count: 0,
      max_attempts: this.maxAttempts,
      next_attempt_at: null,
      locked_at: null,
      last_attempt_at: null,
      error_message: null,
      created_at: ts,
      updated_at: ts,
    };
    db.prepare(
      `INSERT INTO outbox_events
       (id, tenant_id, topic, aggregate_type, aggregate_id, payload, status, retry_count, max_attempts,
        next_attempt_at, locked_at, last_attempt_at, error_message, created_at, updated_at)
       VALUES (@id, @tenant_id, @topic, @aggregate_type, @aggregate_id, @payload, @status, @retry_count, @max_attempts,
        @next_attempt_at, @locked_at, @last_attempt_at, @error_message, @created_at, @updated_at)`
    ).run(event);
    return event;
  }

  listPending(db, limit = this.batchSize) {
    this.ensureSchema(db);
    const ts = now();
    return db.prepare(
      `SELECT *
       FROM outbox_events
       WHERE status = 'pending'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`
    ).all(ts, Math.min(Math.max(Number(limit) || this.batchSize, 1), 500));
  }

  listEvents(db, filters = {}) {
    this.ensureSchema(db);
    const params = [];
    const where = [];
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.topic) {
      where.push('topic = ?');
      params.push(filters.topic);
    }
    if (filters.aggregate_id) {
      where.push('aggregate_id = ?');
      params.push(filters.aggregate_id);
    }
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(
      `SELECT *
       FROM outbox_events
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
  }

  claimEvent(db, id) {
    this.ensureSchema(db);
    const ts = now();
    db.prepare(
      `UPDATE outbox_events
       SET locked_at = ?, last_attempt_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    ).run(ts, ts, ts, id);
  }

  markPublished(db, id) {
    this.ensureSchema(db);
    const ts = now();
    db.prepare(
      `UPDATE outbox_events
       SET status = 'published', error_message = NULL, locked_at = NULL, next_attempt_at = NULL,
           published_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(ts, ts, id);
  }

  markFailed(db, event, error) {
    this.ensureSchema(db);
    const retryCount = Number(event.retry_count || 0) + 1;
    const maxAttempts = Number(event.max_attempts || this.maxAttempts);
    const retryable = retryCount < maxAttempts;
    const ts = now();
    const nextAttemptAt = retryable ? addMinutes(new Date(), Math.min(30, 2 ** Math.min(retryCount, 5))) : null;
    db.prepare(
      `UPDATE outbox_events
       SET status = ?,
           retry_count = ?,
           max_attempts = ?,
           error_message = ?,
           next_attempt_at = ?,
           locked_at = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(retryable ? 'pending' : 'failed', retryCount, maxAttempts, error.message, nextAttemptAt, ts, event.id);
    return { id: event.id, status: retryable ? 'pending' : 'failed', retryable, error: error.message };
  }

  retryFailed(db, id) {
    this.ensureSchema(db);
    const ts = now();
    const result = db.prepare(
      `UPDATE outbox_events
       SET status = 'pending', next_attempt_at = NULL, locked_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'failed'`
    ).run(ts, id);
    return result.changes > 0;
  }

  async dispatchEvent(event, dispatcher) {
    if (typeof dispatcher === 'function') return dispatcher(event);
    if (dispatcher && typeof dispatcher.publish === 'function') return dispatcher.publish(event);
    return { skipped: true, reason: 'dispatcher-not-configured' };
  }

  async processPending(db, options = {}) {
    this.ensureSchema(db);
    const events = this.listPending(db, options.limit || this.batchSize);
    const results = [];
    for (const event of events) {
      this.claimEvent(db, event.id);
      try {
        await this.dispatchEvent({
          ...event,
          payload: JSON.parse(event.payload || '{}'),
        }, options.dispatcher);
        this.markPublished(db, event.id);
        results.push({ id: event.id, status: 'published' });
      } catch (err) {
        const result = this.markFailed(db, event, err);
        results.push(result);
      }
    }
    return {
      processed: results.length,
      published: results.filter(result => result.status === 'published').length,
      failed: results.filter(result => result.status === 'failed').length,
      retrying: results.filter(result => result.retryable).length,
      results,
    };
  }
}

module.exports = new EventBus();
