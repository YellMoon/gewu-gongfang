const { v4: uuidv4 } = require('uuid');

class EventBus {
  publish(db, topic, aggregateType, aggregateId, payload = {}, tenantId = 'default') {
    const now = new Date().toISOString();
    const event = {
      id: uuidv4(),
      tenant_id: tenantId,
      topic,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      payload: JSON.stringify(payload),
      status: 'pending',
      retry_count: 0,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO outbox_events
       (id, tenant_id, topic, aggregate_type, aggregate_id, payload, status, retry_count, created_at, updated_at)
       VALUES (@id, @tenant_id, @topic, @aggregate_type, @aggregate_id, @payload, @status, @retry_count, @created_at, @updated_at)`
    ).run(event);
    return event;
  }

  listPending(db, limit = 100) {
    return db.prepare(
      `SELECT * FROM outbox_events WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
    ).all(limit);
  }

  markPublished(db, id) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE outbox_events SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, id);
  }
}

module.exports = new EventBus();
