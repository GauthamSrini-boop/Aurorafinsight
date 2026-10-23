-- 002 (PostgreSQL): mirrors sqlite/002_extended_features.sql.

ALTER TABLE users ADD COLUMN opening_balance_minor BIGINT NOT NULL DEFAULT 0
  CHECK (opening_balance_minor BETWEEN -100000000000 AND 100000000000);
ALTER TABLE users ADD COLUMN smartsave_target_minor BIGINT
  CHECK (smartsave_target_minor IS NULL OR smartsave_target_minor BETWEEN 0 AND 100000000000);

ALTER TABLE transactions ADD COLUMN payment_method TEXT
  CHECK (payment_method IS NULL OR char_length(payment_method) BETWEEN 1 AND 40);
CREATE INDEX transactions_user_amount_idx ON transactions (user_id, amount_minor);

ALTER TABLE goals ADD COLUMN description TEXT CHECK (description IS NULL OR char_length(description) <= 300);
ALTER TABLE goals ADD COLUMN category TEXT CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 40);
ALTER TABLE goals ADD COLUMN archived_at TEXT;

ALTER TABLE goal_contributions ADD COLUMN kind TEXT NOT NULL DEFAULT 'deposit' CHECK (kind IN ('deposit', 'withdrawal'));

CREATE OR REPLACE FUNCTION goal_contributions_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target BIGINT; total BIGINT;
BEGIN
  SELECT target_minor INTO target FROM goals WHERE id = NEW.goal_id FOR UPDATE;
  SELECT COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END), 0) INTO total FROM goal_contributions WHERE goal_id = NEW.goal_id;
  IF NEW.kind = 'deposit' AND total + NEW.amount_minor > target THEN
    RAISE EXCEPTION 'contribution exceeds the goal target' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'withdrawal' AND total - NEW.amount_minor < 0 THEN
    RAISE EXCEPTION 'withdrawal exceeds the amount saved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION goals_target_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END), 0) INTO total FROM goal_contributions WHERE goal_id = NEW.id;
  IF NEW.target_minor < total THEN
    RAISE EXCEPTION 'target cannot be lower than the amount already saved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
