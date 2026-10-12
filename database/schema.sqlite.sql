-- Prompt Trap Lab — مخطط SQLite (للتشغيل المحلي والاختبارات)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'trainee',
  password_hash TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  owner_user_id INTEGER NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (scenario_id) REFERENCES training_scenarios(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  scenario_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_id) REFERENCES training_scenarios(id),
  FOREIGN KEY (source_id) REFERENCES source_documents(id)
);

CREATE TABLE IF NOT EXISTS prompt_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  evaluated_at TEXT NULL,
  revealed_at TEXT NULL,
  trainee_verdict TEXT NULL,
  UNIQUE (session_id, attempt_no),
  FOREIGN KEY (session_id) REFERENCES training_sessions(id) ON DELETE CASCADE
);

-- بيانات سرية: لا تُقرأ عبر الواجهة قبل الكشف
CREATE TABLE IF NOT EXISTS prompt_analyses (
  attempt_id INTEGER PRIMARY KEY,
  score INTEGER NOT NULL,
  mode TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  gaps_json TEXT NOT NULL,
  requested_json TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generated_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  is_simulation INTEGER NOT NULL DEFAULT 1,
  style TEXT NOT NULL,
  output_text TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  units_json TEXT NOT NULL,
  provider_note TEXT NULL,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
);

-- بيانات سرية
CREATE TABLE IF NOT EXISTS error_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  error_type TEXT NOT NULL,
  label TEXT NOT NULL,
  severity TEXT NOT NULL,
  unit_id TEXT NULL,
  claim TEXT NOT NULL,
  source_evidence_json TEXT NOT NULL,
  correct_value TEXT NOT NULL,
  explanation TEXT NOT NULL,
  cause_dim TEXT NOT NULL,
  fabricated INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
);

-- بيانات سرية: مفتاح الإجابة
CREATE TABLE IF NOT EXISTS answer_keys (
  attempt_id INTEGER PRIMARY KEY,
  source_snapshot TEXT NOT NULL,
  prompt_snapshot TEXT NOT NULL,
  output_snapshot TEXT NOT NULL,
  omitted_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  correct_answer_text TEXT NOT NULL,
  correct_units_json TEXT NOT NULL,
  improved_prompt TEXT NOT NULL,
  no_error_note TEXT NULL,
  stats_json TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
);
