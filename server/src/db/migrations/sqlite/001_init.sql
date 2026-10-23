-- Aurora FinSight schema (SQLite). Money is integer minor units (paise/cents).
-- Dates are ISO text (YYYY-MM-DD). Every user-owned table carries user_id and
-- cross-table references are composite (id, user_id), so a row can never
-- point at another user's category or goal.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  name          TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  password_hash TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  theme         TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light','system')),
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  notify_budget INTEGER NOT NULL DEFAULT 1 CHECK (notify_budget IN (0,1)),
  notify_goals  INTEGER NOT NULL DEFAULT 1 CHECK (notify_goals IN (0,1)),
  notify_tips   INTEGER NOT NULL DEFAULT 1 CHECK (notify_tips IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  kind       TEXT NOT NULL CHECK (kind IN ('expense','income')),
  color      TEXT NOT NULL DEFAULT 'slate' CHECK (color IN ('indigo','cyan','emerald','amber','rose','violet','sky','orange','slate')),
  flexible   INTEGER NOT NULL DEFAULT 0 CHECK (flexible IN (0,1)),   -- discretionary spending (used by SmartSave)
  created_at TEXT NOT NULL,
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX categories_unique_name ON categories (user_id, kind, lower(name));

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('expense','income')),
  title        TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  category_id  TEXT NOT NULL,
  txn_date     TEXT NOT NULL CHECK (txn_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND txn_date >= '2000-01-01'),
  note         TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE RESTRICT
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, txn_date);
CREATE INDEX transactions_user_category_idx ON transactions (user_id, category_id);

-- A budget applies from effective_month onwards until a later row replaces it.
-- category_id NULL = the overall monthly budget.
CREATE TABLE budgets (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id     TEXT,
  effective_month TEXT NOT NULL CHECK (effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  amount_minor    INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX budgets_unique ON budgets (user_id, coalesce(category_id, ''), effective_month);

CREATE TABLE goals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  target_minor INTEGER NOT NULL CHECK (target_minor BETWEEN 1 AND 100000000000),
  deadline     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (id, user_id)
);

CREATE TABLE goal_contributions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  goal_id        TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  contributed_on TEXT NOT NULL CHECK (contributed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note           TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_at     TEXT NOT NULL,
  FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions (goal_id, contributed_on);

-- Defence in depth: the database itself refuses to overfill a goal or to
-- lower a target below what is already saved.
CREATE TRIGGER goal_contributions_capacity BEFORE INSERT ON goal_contributions
BEGIN
  SELECT RAISE(ABORT, 'contribution exceeds the goal target')
  WHERE (SELECT COALESCE(SUM(amount_minor), 0) FROM goal_contributions WHERE goal_id = NEW.goal_id) + NEW.amount_minor
        > (SELECT target_minor FROM goals WHERE id = NEW.goal_id);
END;

CREATE TRIGGER goals_target_guard BEFORE UPDATE OF target_minor ON goals
BEGIN
  SELECT RAISE(ABORT, 'target cannot be lower than the amount already saved')
  WHERE NEW.target_minor < (SELECT COALESCE(SUM(amount_minor), 0) FROM goal_contributions WHERE goal_id = NEW.id);
END;
