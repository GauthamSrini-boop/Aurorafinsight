import { randomUUID } from 'node:crypto';

const DEFAULT_CATEGORIES = [
  ['Food & Dining', 'expense', 'amber', 1],
  ['Transport', 'expense', 'sky', 0],
  ['Shopping', 'expense', 'violet', 1],
  ['Bills & Utilities', 'expense', 'rose', 0],
  ['Entertainment', 'expense', 'indigo', 1],
  ['Health', 'expense', 'cyan', 0],
  ['Education', 'expense', 'orange', 0],
  ['Other', 'expense', 'slate', 1],
  ['Salary', 'income', 'emerald', 0],
  ['Freelance', 'income', 'cyan', 0],
  ['Investments', 'income', 'violet', 0],
  ['Other income', 'income', 'slate', 0],
];

export const userToJSON = (u) => ({
  id: u.id, email: u.email, name: u.name, currency: u.currency, theme: u.theme, timezone: u.timezone,
  openingBalanceMinor: Number(u.opening_balance_minor ?? 0), smartsaveTargetMinor: u.smartsave_target_minor === null || u.smartsave_target_minor === undefined ? null : Number(u.smartsave_target_minor),
  notifications: { budget: !!u.notify_budget, goals: !!u.notify_goals, tips: !!u.notify_tips },
  createdAt: u.created_at,
});

/** Creates the user and their starter categories atomically. */
export async function createUser(db, { name, email, passwordHash, timezone }, now) {
  const id = randomUUID();
  const stamp = now.toISOString();
  await db.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO users (id, email, name, password_hash, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, email, name, passwordHash, timezone, stamp, stamp],
    );
    for (const [cname, kind, color, flexible] of DEFAULT_CATEGORIES) {
      await tx.run(
        'INSERT INTO categories (id, user_id, name, kind, color, flexible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), id, cname, kind, color, flexible, stamp],
      );
    }
  });
  return id;
}

export const findUserByEmail = (db, email) => db.get('SELECT * FROM users WHERE lower(email) = ?', [email.toLowerCase()]);
export const findUserById = (db, id) => db.get('SELECT * FROM users WHERE id = ?', [id]);
