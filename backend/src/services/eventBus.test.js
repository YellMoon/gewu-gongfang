const assert = require('assert');
const Module = require('module');

let sequence = 0;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'uuid') {
    return { v4: () => `event-${++sequence}` };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const eventBus = require('./eventBus');

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  run(...args) {
    return this.db.run(this.sql, args);
  }

  all(...args) {
    return this.db.all(this.sql, args);
  }

  get(...args) {
    return this.db.get(this.sql, args);
  }
}

class FakeDb {
  constructor() {
    this.events = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  run(sql, args) {
    if (sql.includes('INSERT INTO outbox_events')) {
      this.events.push({ ...args[0] });
      return { changes: 1 };
    }

    if (sql.includes("SET locked_at")) {
      const [lockedAt, lastAttemptAt, updatedAt, id] = args;
      const event = this.events.find(row => row.id === id && row.status === 'pending');
      if (!event) return { changes: 0 };
      Object.assign(event, { locked_at: lockedAt, last_attempt_at: lastAttemptAt, updated_at: updatedAt });
      return { changes: 1 };
    }

    if (sql.includes("SET status = 'published'")) {
      const [publishedAt, updatedAt, id] = args;
      const event = this.events.find(row => row.id === id);
      Object.assign(event, {
        status: 'published',
        error_message: null,
        locked_at: null,
        next_attempt_at: null,
        published_at: publishedAt,
        updated_at: updatedAt,
      });
      return { changes: 1 };
    }

    if (sql.includes('SET status = ?')) {
      const [status, retryCount, maxAttempts, errorMessage, nextAttemptAt, updatedAt, id] = args;
      const event = this.events.find(row => row.id === id);
      Object.assign(event, {
        status,
        retry_count: retryCount,
        max_attempts: maxAttempts,
        error_message: errorMessage,
        next_attempt_at: nextAttemptAt,
        locked_at: null,
        updated_at: updatedAt,
      });
      return { changes: 1 };
    }

    if (sql.includes("SET status = 'pending'")) {
      const [updatedAt, id] = args;
      const event = this.events.find(row => row.id === id && row.status === 'failed');
      if (!event) return { changes: 0 };
      Object.assign(event, { status: 'pending', next_attempt_at: null, locked_at: null, updated_at: updatedAt });
      return { changes: 1 };
    }

    return { changes: 0 };
  }

  all(sql, args) {
    if (sql.includes('PRAGMA table_info(outbox_events)')) {
      return [
        'id', 'tenant_id', 'topic', 'aggregate_type', 'aggregate_id', 'payload',
        'status', 'retry_count', 'max_attempts', 'next_attempt_at', 'locked_at',
        'last_attempt_at', 'error_message', 'created_at', 'updated_at', 'published_at',
      ].map(name => ({ name }));
    }

    if (sql.includes('FROM outbox_events')) {
      const limit = Number(args[args.length - 1]) || 100;
      return this.events
        .filter(event => event.status === 'pending' && !event.next_attempt_at)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .slice(0, limit)
        .map(event => ({ ...event }));
    }

    return [];
  }

  get(sql, args) {
    if (sql.includes('WHERE id = ?')) {
      const event = this.events.find(row => row.id === args[0]);
      return event ? { ...event } : undefined;
    }
    return undefined;
  }
}

async function main() {
  const db = new FakeDb();
  eventBus.maxAttempts = 2;

  const ok = eventBus.publish(db, 'question.changed', 'question', 'q-ok', { action: 'create' }, 't1');
  const fail = eventBus.publish(db, 'question.changed', 'question', 'q-fail', { action: 'update' }, 't1');

  const first = await eventBus.processPending(db, {
    dispatcher: (event) => {
      if (event.aggregate_id === 'q-fail') throw new Error('mock broker down');
      return { ack: true };
    },
  });
  assert.strictEqual(first.processed, 2);
  assert.strictEqual(first.published, 1);
  assert.strictEqual(first.retrying, 1);

  const published = db.get('SELECT * FROM outbox_events WHERE id = ?', [ok.id]);
  assert.strictEqual(published.status, 'published');
  assert.ok(published.published_at);

  const pendingRetry = db.get('SELECT * FROM outbox_events WHERE id = ?', [fail.id]);
  assert.strictEqual(pendingRetry.status, 'pending');
  assert.strictEqual(pendingRetry.retry_count, 1);
  assert.match(pendingRetry.error_message, /mock broker down/);

  pendingRetry.next_attempt_at = null;
  db.events = db.events.map(event => event.id === pendingRetry.id ? pendingRetry : event);
  const second = await eventBus.processPending(db, {
    dispatcher: () => {
      throw new Error('mock broker still down');
    },
  });
  assert.strictEqual(second.failed, 1);

  const failed = db.get('SELECT * FROM outbox_events WHERE id = ?', [fail.id]);
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.retry_count, 2);

  assert.strictEqual(eventBus.retryFailed(db, fail.id), true);
  const retried = db.get('SELECT * FROM outbox_events WHERE id = ?', [fail.id]);
  assert.strictEqual(retried.status, 'pending');
  assert.strictEqual(retried.next_attempt_at, null);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
