-- Aurora FinSight schema (PostgreSQL 14+). Mirrors the SQLite migration.
-- Money is bigint minor units; dates are ISO text so both engines behave the same.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  name          TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  password_hash TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  theme         TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light','system')),
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  notify_budget SMALLINT NOT NULL DEFAULT 1 CHECK (notify_budget IN (0,1)),
  notify_goals  SMALLINT NOT NULL DEFAULT 1 CHECK (notify_goals IN (0,1)),
  notify_tips   SMALLINT NOT NULL DEFAULT 1 CHECK (notify_tips IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
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
  name       TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  kind       TEXT NOT NULL CHECK (kind IN ('expense','income')),
  color      TEXT NOT NULL DEFAULT 'slate' CHECK (color IN ('indigo','cyan','emerald','amber','rose','violet','sky','orange','slate')),
  flexible   SMALLINT NOT NULL DEFAULT 0 CHECK (flexible IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX categories_unique_name ON categories (user_id, kind, lower(name));

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('expense','income')),
  title        TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  category_id  TEXT NOT NULL,
  txn_date     TEXT NOT NULL CHECK (txn_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND txn_date >= '2000-01-01'),
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE RESTRICT
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, txn_date);
CREATE INDEX transactions_user_category_idx ON transactions (user_id, category_id);

CREATE TABLE budgets (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id     TEXT,
  effective_month TEXT NOT NULL CHECK (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX budgets_unique ON budgets (user_id, coalesce(category_id, ''), effective_month);

CREATE TABLE goals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  target_minor BIGINT NOT NULL CHECK (target_minor BETWEEN 1 AND 100000000000),
  deadline     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (id, user_id)
);

CREATE TABLE goal_contributions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  goal_id        TEXT NOT NULL,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  contributed_on TEXT NOT NULL CHECK (contributed_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  note           TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  created_at     TEXT NOT NULL,
  FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions (goal_id, contributed_on);

-- Goal capacity guards (the goal row is locked so concurrent inserts cannot overshoot).
CREATE FUNCTION goal_contributions_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target BIGINT; total BIGINT;
BEGIN
  SELECT target_minor INTO target FROM goals WHERE id = NEW.goal_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_minor), 0) INTO total FROM goal_contributions WHERE goal_id = NEW.goal_id;
  IF total + NEW.amount_minor > target THEN
    RAISE EXCEPTION 'contribution exceeds the goal target' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER goal_contributions_capacity BEFORE INSERT ON goal_contributions
  FOR EACH ROW EXECUTE FUNCTION goal_contributions_capacity();

CREATE FUNCTION goals_target_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO total FROM goal_contributions WHERE goal_id = NEW.id;
  IF NEW.target_minor < total THEN
    RAISE EXCEPTION 'target cannot be lower than the amount already saved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER goals_target_guard BEFORE UPDATE OF target_minor ON goals
  FOR EACH ROW EXECUTE FUNCTION goals_target_guard();
