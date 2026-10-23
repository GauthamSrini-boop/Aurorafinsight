-- 002: opening balance, payment method, richer goals (description/category/archive/withdrawals), SmartSave target.

ALTER TABLE users ADD COLUMN opening_balance_minor INTEGER NOT NULL DEFAULT 0
  CHECK (opening_balance_minor BETWEEN -100000000000 AND 100000000000);
ALTER TABLE users ADD COLUMN smartsave_target_minor INTEGER
  CHECK (smartsave_target_minor IS NULL OR smartsave_target_minor BETWEEN 0 AND 100000000000);

ALTER TABLE transactions ADD COLUMN payment_method TEXT
  CHECK (payment_method IS NULL OR length(payment_method) BETWEEN 1 AND 40);
CREATE INDEX transactions_user_amount_idx ON transactions (user_id, amount_minor);

ALTER TABLE goals ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 300);
ALTER TABLE goals ADD COLUMN category TEXT CHECK (category IS NULL OR length(category) BETWEEN 1 AND 40);
ALTER TABLE goals ADD COLUMN archived_at TEXT;

-- A goal's saved amount is deposits minus withdrawals. amount_minor stays positive; kind gives the sign.
ALTER TABLE goal_contributions ADD COLUMN kind TEXT NOT NULL DEFAULT 'deposit' CHECK (kind IN ('deposit', 'withdrawal'));

DROP TRIGGER goal_contributions_capacity;
CREATE TRIGGER goal_contributions_capacity BEFORE INSERT ON goal_contributions
BEGIN
  SELECT RAISE(ABORT, 'contribution exceeds the goal target')
  WHERE NEW.kind = 'deposit'
    AND (SELECT COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END), 0) FROM goal_contributions WHERE goal_id = NEW.goal_id) + NEW.amount_minor
        > (SELECT target_minor FROM goals WHERE id = NEW.goal_id);
  SELECT RAISE(ABORT, 'withdrawal exceeds the amount saved')
  WHERE NEW.kind = 'withdrawal'
    AND (SELECT COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END), 0) FROM goal_contributions WHERE goal_id = NEW.goal_id) - NEW.amount_minor < 0;
END;

DROP TRIGGER goals_target_guard;
CREATE TRIGGER goals_target_guard BEFORE UPDATE OF target_minor ON goals
BEGIN
  SELECT RAISE(ABORT, 'target cannot be lower than the amount already saved')
  WHERE NEW.target_minor < (SELECT COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END), 0) FROM goal_contributions WHERE goal_id = NEW.id);
END;
