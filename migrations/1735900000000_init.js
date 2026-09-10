/**
 * Initial schema: accounts, API keys, and raw provider-event logging. No
 * media, no transcripts here — those stay in the ephemeral cache layer per
 * the minimal-retention principle (see docs/architecture.md and
 * docs/privacy.md).
 */

exports.up = (pgm) => {
  pgm.createTable('accounts', {
    id: 'id',
    email: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('api_keys', {
    id: 'id',
    account_id: {
      type: 'integer',
      notNull: true,
      references: 'accounts',
      onDelete: 'CASCADE',
    },
    // Short, non-secret prefix shown in UIs/logs to identify a key (e.g. "moreel_live_ab12").
    key_prefix: { type: 'text', notNull: true },
    // Argon2id hash of the full secret. The secret itself is never stored.
    key_hash: { type: 'text', notNull: true },
    scopes: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('api_keys', 'key_hash', { unique: true });
  pgm.createIndex('api_keys', 'account_id');

  pgm.createTable('provider_events', {
    id: 'id',
    provider: { type: 'text', notNull: true },
    classification: { type: 'text', notNull: true },
    latency_ms: { type: 'real', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('provider_events', 'occurred_at');
};

exports.down = (pgm) => {
  pgm.dropTable('provider_events');
  pgm.dropTable('api_keys');
  pgm.dropTable('accounts');
};
