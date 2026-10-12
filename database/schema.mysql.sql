-- Prompt Trap Lab — مخطط MySQL 5.7+/MariaDB 10.4+
-- الاستخدام اليدوي: mysql -u root -p < database/schema.mysql.sql
-- ثم أنشئ المصدر التجريبي بتشغيل: php bin/install.php
CREATE DATABASE IF NOT EXISTS prompt_trap_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE prompt_trap_lab;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'trainee',
  password_hash VARCHAR(255) NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS training_scenarios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS source_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT UNSIGNED NOT NULL,
  owner_user_id INT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  is_sample TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (scenario_id) REFERENCES training_scenarios(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS training_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  scenario_id INT UNSIGNED NOT NULL,
  source_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_id) REFERENCES training_scenarios(id),
  FOREIGN KEY (source_id) REFERENCES source_documents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prompt_attempts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NOT NULL,
  attempt_no INT UNSIGNED NOT NULL,
  prompt_text TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  evaluated_at DATETIME NULL,
  revealed_at DATETIME NULL,
  trainee_verdict VARCHAR(16) NULL,
  UNIQUE KEY uq_session_attempt (session_id, attempt_no),
  FOREIGN KEY (session_id) REFERENCES training_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- بيانات سرية: لا تُقرأ عبر الواجهة قبل الكشف
CREATE TABLE IF NOT EXISTS prompt_analyses (
  attempt_id INT UNSIGNED PRIMARY KEY,
  score TINYINT UNSIGNED NOT NULL,
  mode VARCHAR(16) NOT NULL,
  dimensions_json MEDIUMTEXT NOT NULL,
  gaps_json TEXT NOT NULL,
  requested_json TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS generated_outputs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT UNSIGNED NOT NULL UNIQUE,
  provider VARCHAR(64) NOT NULL,
  is_simulation TINYINT(1) NOT NULL DEFAULT 1,
  style VARCHAR(16) NOT NULL,
  output_text MEDIUMTEXT NOT NULL,
  headers_json TEXT NOT NULL,
  units_json MEDIUMTEXT NOT NULL,
  provider_note VARCHAR(255) NULL,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- بيانات سرية
CREATE TABLE IF NOT EXISTS error_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  error_type VARCHAR(32) NOT NULL,
  label VARCHAR(64) NOT NULL,
  severity VARCHAR(8) NOT NULL,
  unit_id VARCHAR(16) NULL,
  claim TEXT NOT NULL,
  source_evidence_json TEXT NOT NULL,
  correct_value TEXT NOT NULL,
  explanation TEXT NOT NULL,
  cause_dim VARCHAR(32) NOT NULL,
  fabricated TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- بيانات سرية: مفتاح الإجابة
CREATE TABLE IF NOT EXISTS answer_keys (
  attempt_id INT UNSIGNED PRIMARY KEY,
  source_snapshot MEDIUMTEXT NOT NULL,
  prompt_snapshot TEXT NOT NULL,
  output_snapshot MEDIUMTEXT NOT NULL,
  omitted_json MEDIUMTEXT NOT NULL,
  assumptions_json MEDIUMTEXT NOT NULL,
  correct_answer_text MEDIUMTEXT NOT NULL,
  correct_units_json MEDIUMTEXT NOT NULL,
  improved_prompt TEXT NOT NULL,
  no_error_note VARCHAR(255) NULL,
  stats_json TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES prompt_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
