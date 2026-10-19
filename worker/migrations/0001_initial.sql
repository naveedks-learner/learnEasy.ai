CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  theme_json TEXT,
  allowed_origins_json TEXT,
  features_json TEXT,
  rate_limits_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE config (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  path_taken TEXT,
  question TEXT,
  answer TEXT,
  model TEXT,
  provider TEXT,
  trace_json TEXT,
  token_estimate INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

CREATE TABLE question_paper_cache (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

CREATE TABLE rate_limits (
  tenant_id TEXT NOT NULL,
  window TEXT NOT NULL,  -- e.g. "2026-10-19T12:05"
  count INTEGER DEFAULT 0,
  PRIMARY KEY (tenant_id, window)
);

INSERT INTO tenants (tenant_id, name, domain, theme_json, features_json, rate_limits_json, allowed_origins_json)
VALUES ('default', 'Dev School', 'localhost:8787',
  '{"primaryColor":"#2563eb","accentColor":"#1e40af"}',
  '{"conceptExplainerEnabled":true,"questionPaperEnabled":true,"webSearchEnabled":true}',
  '{"chatRequestsPerMinute":60,"ingestMaxFileSizeMb":50}',
  '["*"]');
