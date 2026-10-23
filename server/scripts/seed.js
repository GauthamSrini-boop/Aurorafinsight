// Optional DEVELOPMENT seed: creates one clearly-labelled demo account with a few months of sample data.
// Never runs in production and never touches real users' accounts.
//   npm run seed            -> create demo@aurora.test (password from SEED_PASSWORD or "Demo-Pass-123")
//   npm run seed -- --reset -> delete the demo account first, then re-create it
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createUser, findUserByEmail } from '../src/services/users.js';
import { hashPassword } from '../src/lib/password.js';
import { addDays, addMonths, monthOf, monthStart, todayIn } from '../src/lib/dates.js';

const config = loadConfig();
if (config.isProd || process.env.ALLOW_SEED === 'false') {
  console.error('Refusing to seed: NODE_ENV=production. The seed script is for development only.');
  process.exit(1);
}
const EMAIL = 'demo@aurora.test';
const PASSWORD = process.env.SEED_PASSWORD || 'Demo-Pass-123';
const TZ = process.env.SEED_TIMEZONE || 'Asia/Kolkata';

const db = await openDatabase(config.databaseUrl);
await migrate(db);
const existing = await findUserByEmail(db, EMAIL);
if (existing && process.argv.includes('--reset')) { await db.run('DELETE FROM users WHERE id = ?', [existing.id]); console.log('Removed the existing demo account.'); }
else if (existing) { console.error(`${EMAIL} already exists. Run with --reset to recreate it.`); await db.close(); process.exit(1); }

const now = new Date();
const today = todayIn(TZ, now);
const userId = await createUser(db, { name: 'Demo User', email: EMAIL, passwordHash: await hashPassword(PASSWORD, config.scryptN), timezone: TZ }, now);
const cats = new Map((await db.all('SELECT id, name FROM categories WHERE user_id = ?', [userId])).map((c) => [c.name, c.id]));
const stamp = now.toISOString();

// small deterministic PRNG so the sample data is the same on every run
let seed = 20261015;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const rupees = (lo, hi) => Math.round(lo + rnd() * (hi - lo)) * 100;

const rows = [];
const add = (kind, title, amount, category, date, paymentMethod = null) => { if (date <= today) rows.push([randomUUID(), userId, kind, title, amount, cats.get(category), date, paymentMethod, stamp, stamp]); };
for (let i = 5; i >= 0; i -= 1) {
  const m = addMonths(monthOf(today), -i);
  const start = monthStart(m);
  add('income', 'Salary', 6_500_000, 'Salary', addDays(start, 0), 'Bank transfer');
  if (i % 2 === 0) add('income', 'Freelance project', rupees(8000, 20000), 'Freelance', addDays(start, 14), 'UPI');
  add('expense', 'Rent', 1_800_000, 'Bills & Utilities', addDays(start, 1), 'Bank transfer');
  add('expense', 'Electricity', rupees(1200, 2400), 'Bills & Utilities', addDays(start, 6), 'UPI');
  add('expense', 'Streaming subscription', 64900, 'Entertainment', addDays(start, 3), 'Card');
  for (let d = 0; d < 28; d += 1) {
    if (rnd() < 0.55) add('expense', pick(['Groceries', 'Lunch', 'Coffee', 'Dinner out', 'Snacks']), rupees(80, 1400), 'Food & Dining', addDays(start, d), pick(['UPI', 'Card', 'Cash']));
    if (rnd() < 0.25) add('expense', pick(['Auto ride', 'Metro recharge', 'Fuel']), rupees(60, 700), 'Transport', addDays(start, d), 'UPI');
    if (rnd() < 0.08) add('expense', pick(['Clothes', 'Online order', 'Gadget accessory']), rupees(500, 4000), 'Shopping', addDays(start, d), 'Card');
  }
}
await db.transaction(async (tx) => {
  for (const r of rows) await tx.run('INSERT INTO transactions (id, user_id, kind, title, amount_minor, category_id, txn_date, payment_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', r);
  await tx.run('INSERT INTO budgets (id, user_id, category_id, effective_month, amount_minor, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)', [randomUUID(), userId, addMonths(monthOf(today), -5), 4_500_000, stamp, stamp]);
  await tx.run('INSERT INTO budgets (id, user_id, category_id, effective_month, amount_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), userId, cats.get('Food & Dining'), addMonths(monthOf(today), -5), 1_000_000, stamp, stamp]);
  const goal = async (name, target, saved, description, category, deadlineDays) => {
    const id = randomUUID();
    await tx.run('INSERT INTO goals (id, user_id, name, target_minor, deadline, description, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, userId, name, target, deadlineDays ? addDays(today, deadlineDays) : null, description, category, stamp, stamp]);
    for (let k = 1; k <= 4; k += 1) if (saved > 0) await tx.run("INSERT INTO goal_contributions (id, user_id, goal_id, amount_minor, contributed_on, kind, created_at) VALUES (?, ?, ?, ?, ?, 'deposit', ?)", [randomUUID(), userId, id, Math.round(saved / 4), addDays(today, -k * 20), stamp]);
  };
  await goal('Emergency fund', 30_000_000, 8_000_000, 'Six months of expenses', 'Safety', 300);
  await goal('New laptop', 9_000_000, 3_600_000, null, 'Gadgets', 120);
  await goal('Goa trip', 4_000_000, 0, 'With friends', 'Travel', 200);
});
console.log(`Seeded ${EMAIL} (password: ${PASSWORD}) with ${rows.length} transactions, 2 budgets and 3 goals.`);
await db.close();
