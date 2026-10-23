// End-to-end browser test: drives the BUILT client served by the real server against a real database.
// Usage: BASE_URL=http://localhost:4100 SHOTS=./shots node e2e/e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:4100';
const SHOTS = process.env.SHOTS ?? path.resolve('shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TZ = 'Asia/Kolkata';
const stamp = Date.now();
const A = { name: 'Asha Verma', email: `asha.${stamp}@example.com`, password: 'Correct-Horse-9' };
const B = { name: 'Bala Kumar', email: `bala.${stamp}@example.com`, password: 'Another-Pass-7' };

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shiftDay = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = todayISO();
const prevMonthDate = (() => { const [y, m] = today.split('-').map(Number); const t = y * 12 + (m - 1) - 1; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-05`; })();

const browser = await chromium.launch();
const ctx = await browser.newContext({ timezoneId: TZ, locale: 'en-IN', viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

let passed = 0; const failures = [];
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); } catch (e) {
    failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 4).join('\n       ')}`);
    await page.screenshot({ path: path.join(SHOTS, `FAIL-${failures.length}.png`), fullPage: true }).catch(() => {});
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
const nav = async (label) => { await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label }).click(); await page.waitForLoadState('networkidle'); };
const dialog = () => page.getByRole('dialog');
const toastText = () => page.getByRole('region', { name: 'Notifications' }).innerText();

async function addTxn({ kind = 'expense', amount, title, category, date, note, paymentMethod }) {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog();
  if (kind === 'income') await d.getByRole('radio', { name: 'Income' }).click();
  await d.getByLabel(/^Amount/).fill(String(amount));
  await d.getByLabel('Description').fill(title);
  if (category) await d.getByLabel('Category').selectOption({ label: category });
  if (date) await d.getByLabel('Date').fill(date);
  if (note) await d.getByLabel(/^Note/).fill(note);
  if (paymentMethod) await d.getByLabel(/^Payment method/).fill(paymentMethod);
  await d.getByRole('button', { name: 'Add transaction' }).click();
}
// Wait until the table shows exactly n rows (filters refetch asynchronously, so never count immediately).
async function rowsEq(n, msg) {
  try { await page.waitForFunction((want) => document.querySelectorAll('tbody tr').length === want, n, { timeout: 8000 }); }
  catch { throw new Error(`${msg} (rows now: ${await page.locator('tbody tr').count()})`); }
}
async function signIn(u) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(u.email); await page.getByLabel('Password', { exact: true }).fill(u.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function signOut() { await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByRole('heading', { name: 'Welcome back' }).waitFor(); }

console.log(`E2E against ${BASE} (today in ${TZ}: ${today})`);

await step('unauthenticated visit redirects to sign-in', async () => {
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  expect(new URL(page.url()).pathname === '/login', `url ${page.url()}`);
  await shot('01-login');
});

await step('register validation shows field errors and does not submit', async () => {
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Enter your name.').waitFor();
  await page.getByLabel('Name').fill('X'); await page.getByLabel('Email').fill('nope'); await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Enter a valid email address.').waitFor();
  await page.getByText('Use at least 8 characters.').waitFor();
});

await step('register user A lands on an empty dashboard', async () => {
  await page.getByLabel('Name').fill(A.name); await page.getByLabel('Email').fill(A.email); await page.getByLabel('Password', { exact: true }).fill(A.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Nothing here yet').waitFor();
  expect(new URL(page.url()).pathname === '/dashboard', 'not on dashboard');
  const cookies = await ctx.cookies();
  const sid = cookies.find((c) => c.name === 'aurora_sid');
  expect(sid && sid.httpOnly && sid.sameSite === 'Lax', `session cookie flags: ${JSON.stringify(sid)}`);
  expect(!(await page.evaluate(() => document.cookie)).includes('aurora_sid'), 'cookie readable from JS');
  await shot('02-dashboard-empty');
});

await step('add income and expenses; dashboard figures come from the database', async () => {
  await addTxn({ kind: 'income', amount: 50000, title: 'October salary', category: 'Salary' });
  await page.getByText('Income added.').waitFor();
  await addTxn({ amount: '1,250.50', title: 'Groceries', category: 'Food & Dining', note: 'Weekly shop', paymentMethod: 'UPI' });
  await page.getByText('Expense added.').first().waitFor();
  await addTxn({ amount: 400, title: 'Bus pass', category: 'Transport' });
  await addTxn({ amount: 900, title: 'Old rent', category: 'Bills & Utilities', date: prevMonthDate });
  await page.waitForTimeout(400);
  await page.getByText('₹47,449.50').first().waitFor(); // 50000 − 1250.50 − 400 − 900
  const text = await page.locator('main').innerText();
  expect(text.includes('₹50,000'), 'income missing');
  expect(text.includes('₹1,650.50'), `monthly expenses wrong: ${text.slice(0, 400)}`);
  expect(text.includes('Groceries') && text.includes('Bus pass'), 'recent list missing');
  await shot('03-dashboard-data');
});

await step('dashboard refresh button reloads from the server', async () => {
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByText('Dashboard refreshed from the server.').waitFor();
});

await step('future-dated transactions are rejected', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog();
  await d.getByLabel(/^Amount/).fill('10'); await d.getByLabel('Description').fill('Time traveller');
  await d.getByLabel('Date').fill(shiftDay(today, 1));
  await d.getByRole('button', { name: 'Add transaction' }).click();
  await d.getByText('Transactions cannot be dated in the future.').waitFor();
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
});

await step('invalid amounts are rejected with messages', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog();
  await d.getByLabel('Description').fill('x');
  for (const [v, msg] of [['', 'Enter an amount.'], ['abc', 'Enter a valid number'], ['1.234', 'at most 2 decimal'], ['0', 'greater than 0']]) {
    await d.getByLabel(/^Amount/).fill(v);
    await d.getByRole('button', { name: 'Add transaction' }).click();
    await d.getByText(new RegExp(msg)).waitFor();
  }
  await page.keyboard.press('Escape');
});

await step('transactions: search, filters, edit, delete', async () => {
  await nav('Transactions');
  await page.getByText('4 transactions').waitFor();
  await page.getByPlaceholder('Search description or note').fill('shop'); // matches the note
  await page.getByText('1 transaction match').waitFor();
  await rowsEq(1, 'search by note');
  await page.getByPlaceholder('Search description or note').fill('');
  await page.getByLabel('Type', { exact: true }).selectOption('income');
  await page.getByRole('row', { name: /October salary/ }).waitFor();
  await rowsEq(1, 'type filter should leave exactly one row');
  await page.getByLabel('Type', { exact: true }).selectOption('');
  await page.getByLabel('From', { exact: true }).fill(prevMonthDate); await page.getByLabel('To', { exact: true }).fill(prevMonthDate);
  await page.getByRole('row', { name: /Old rent/ }).waitFor();
  await rowsEq(1, 'date filter should leave exactly one row');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Year', { exact: true }).selectOption(prevMonthDate.slice(0, 4)); await page.getByLabel('Month', { exact: true }).selectOption(String(Number(prevMonthDate.slice(5, 7))));
  await page.getByRole('row', { name: /Old rent/ }).waitFor();
  await rowsEq(1, 'year+month filter should leave exactly one row');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Payment method', { exact: true }).fill('upi');
  await page.getByRole('row', { name: /Groceries/ }).waitFor();
  await rowsEq(1, 'payment method filter');
  expect((await page.locator('tbody').innerText()).includes('UPI'), 'payment method shown in the row');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Min amount').fill('1,000'); await page.getByLabel('Max amount').fill('2,000');
  await page.getByRole('row', { name: /Groceries/ }).waitFor();
  await rowsEq(1, 'amount range filter should leave exactly one row');
  await page.getByLabel('Min amount').fill('3000');
  await page.getByText('Minimum amount cannot exceed the maximum.').waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByPlaceholder('Search description or note').fill('zzzz');
  await page.getByText('No matching transactions').waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await page.getByText('4 transactions').waitFor();
  await page.getByRole('button', { name: 'Edit Bus pass' }).click();
  await dialog().getByLabel(/^Amount/).fill('450');
  await dialog().getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Transaction updated.').waitFor();
  await page.getByRole('row', { name: /Bus pass/ }).getByText('450').waitFor();
  await page.getByRole('button', { name: 'Delete Old rent' }).click();
  await dialog().getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('3 transactions').waitFor();
  await shot('04-transactions');
});

await step('budgets: set overall + category budgets, see status, remaining and suggested daily spend', async () => {
  await nav('Budgets');
  await page.getByText('No monthly budget').waitFor();
  await page.getByRole('button', { name: 'Set budget' }).click();
  await dialog().getByLabel(/^Budget amount/).fill('2000');
  await dialog().getByRole('button', { name: 'Save budget' }).click();
  await page.getByText('Budget saved.').waitFor();
  await page.getByRole('region').filter({ hasText: 'Category budgets' }).getByRole('button', { name: 'Add' }).click();
  await dialog().getByLabel('Category').selectOption({ label: 'Food & Dining' });
  await dialog().getByLabel(/^Budget amount/).fill('1000');
  await dialog().getByRole('button', { name: 'Save budget' }).click();
  await page.getByText('Over budget', { exact: true }).waitFor();
  const t = await page.locator('main').innerText();
  expect(t.includes('Over by ₹250.50'), `category overage: ${t}`);
  expect(/Suggested/.test(t), 'suggested daily missing');
  expect(/\d+ days? left/.test(t), `days remaining missing: ${t}`);
  expect(/85% used/.test(t), `overall percent: ${t}`); // 1700.50 of 2000
  await shot('05-budgets');
});

await step('adding an expense that crosses the budget raises an alert', async () => {
  await nav('Dashboard');
  await addTxn({ amount: 400, title: 'Concert tickets', category: 'Entertainment' });
  const toasts = page.getByRole('region', { name: 'Notifications' });
  await toasts.getByText(/Your monthly budget is now .* over budget/).waitFor();
});

await step('goals: create, contribute, history, validation, completion guard', async () => {
  await nav('Savings Goals');
  await page.getByRole('button', { name: 'Create your first goal' }).click();
  await dialog().getByLabel('Goal name').fill('Laptop');
  await dialog().getByLabel(/^Target amount/).fill('10000');
  await dialog().getByLabel(/^Already saved/).fill('2000');
  await dialog().getByRole('button', { name: 'Create goal' }).click();
  await page.getByRole('heading', { name: 'Laptop' }).waitFor();
  await page.getByRole('button', { name: 'New goal' }).click();
  await dialog().getByLabel('Goal name').fill('Trip');
  await dialog().getByLabel(/^Target amount/).fill('5000');
  await dialog().getByLabel(/^Target date/).fill(shiftDay(today, 100));
  await dialog().getByRole('button', { name: 'Create goal' }).click();
  await page.getByRole('heading', { name: 'Trip' }).waitFor();
  await page.getByText(/Save about/).first().waitFor();
  const laptop = page.locator('.goal', { hasText: 'Laptop' });
  await laptop.getByRole('button', { name: 'Add savings' }).click();
  await dialog().getByLabel(/^Amount/).fill('9000');
  await dialog().getByRole('button', { name: 'Add savings' }).click();
  await dialog().getByText(/Only .*8,000 is needed/).waitFor();
  await dialog().getByLabel(/^Amount/).fill('500');
  await dialog().getByRole('button', { name: 'Add savings' }).click();
  await page.getByText('Added ₹500 to Laptop.').waitFor();
  await page.waitForTimeout(400);
  expect((await laptop.innerText()).includes('25%'), `percent: ${await laptop.innerText()}`);
  await laptop.getByRole('button', { name: 'History' }).click();
  await dialog().getByText('₹500').waitFor();
  await page.keyboard.press('Escape');
  // complete the goal -> celebration
  await laptop.getByRole('button', { name: 'Add savings' }).click();
  await dialog().getByLabel(/^Amount/).fill('7500');
  await dialog().getByRole('button', { name: 'Add savings' }).click();
  await page.getByText('Goal reached: Laptop!').waitFor();
  await laptop.getByText('Completed').waitFor();
  expect(await laptop.getByRole('button', { name: 'Add savings' }).isDisabled(), 'completed goal still accepts savings');
  // withdraw / correct, then re-complete
  await laptop.getByRole('button', { name: 'Withdraw' }).click();
  await dialog().getByLabel(/^Amount/).fill('999999');
  await dialog().getByRole('button', { name: 'Withdraw' }).click();
  await dialog().getByText(/Only .*10,000 is saved/).waitFor();
  await dialog().getByLabel(/^Amount/).fill('500');
  await dialog().getByRole('button', { name: 'Withdraw' }).click();
  await page.getByText('Withdrew ₹500 from Laptop.').waitFor();
  await page.waitForTimeout(400);
  expect(!(await laptop.innerText()).includes('Completed'), 'goal should reopen after a withdrawal');
  await laptop.getByRole('button', { name: 'History' }).click();
  await dialog().getByText(/Withdrawal/).waitFor();
  await page.keyboard.press('Escape');
  await laptop.getByRole('button', { name: 'Add savings' }).click();
  await dialog().getByLabel(/^Amount/).fill('500');
  await dialog().getByRole('button', { name: 'Add savings' }).click();
  await laptop.getByText('Completed').waitFor();
  // description + category on a goal, archive and restore
  await page.getByRole('button', { name: 'Edit Trip' }).click();
  await dialog().getByLabel(/^Category/).fill('Travel');
  await dialog().getByLabel(/^Description/).fill('Weekend with friends');
  await dialog().getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Weekend with friends').waitFor();
  await page.getByRole('button', { name: 'Archive Trip' }).click();
  await dialog().getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByText('Goal archived.').waitFor();
  await page.getByRole('tab', { name: /Active \(1\)/ }).waitFor();
  await page.getByRole('tab', { name: /Archived \(1\)/ }).click();
  await page.getByRole('heading', { name: 'Trip' }).waitFor();
  await page.getByRole('button', { name: 'Restore' }).click();
  await dialog().getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByText('Goal restored.').waitFor();
  await page.getByRole('tab', { name: /Active \(2\)/ }).click();
  await shot('06-goals');
});

await step('analytics shows real breakdown, comparison and trends', async () => {
  await nav('Analytics');
  await page.getByRole('heading', { name: 'Category breakdown' }).waitFor();
  const t = await page.locator('main').innerText();
  expect(t.includes('Food & Dining') && t.includes('Entertainment'), 'categories missing');
  await page.getByLabel('Filter by category').selectOption({ label: 'Entertainment' });
  await page.getByText(/limited to/).waitFor();
  await page.waitForTimeout(500);
  const filtered = await page.locator('main').innerText();
  expect(filtered.includes('₹400'), `filtered spend should be ₹400: ${filtered.slice(0, 500)}`);
  await page.getByRole('button', { name: 'Show all' }).click();
  await page.getByRole('heading', { name: /trends/ }).waitFor();
  await page.getByText('Highest month').waitFor();
  await shot('07-analytics');
});

await step('smartsave refuses to guess with little data', async () => {
  await nav('SmartSave');
  await page.getByText('SmartSave needs a little more history').waitFor();
  await page.getByRole('button', { name: 'Set target' }).click();
  await page.getByText(/Enter the most you want/).waitFor();
  await page.getByLabel(/^Monthly flexible-spending target/).fill('1000');
  await page.getByRole('button', { name: 'Set target' }).click();
  await page.getByText('Target saved.').waitFor();
  await page.getByText('Over target').waitFor();
  await page.getByText(/Projected month end/).waitFor();
  await page.reload();
  await page.getByText('Over target').waitFor(); // persisted server-side
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByText('Target cleared.').waitFor();
  await shot('08-smartsave');
});

await step('settings: theme, currency and notifications persist across reload', async () => {
  await nav('Settings');
  await page.getByRole('radio', { name: 'Light' }).click();
  await page.getByText('Theme updated.').waitFor();
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'light theme not applied');
  await page.getByLabel('Display currency').selectOption('USD');
  await page.getByText('Currency updated.').waitFor();
  await page.getByRole('switch', { name: 'Budget alerts' }).click();
  await page.waitForTimeout(500);
  await shot('09-settings-light');
  await page.reload(); await page.getByRole('heading', { name: 'Settings' }).waitFor();
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'theme lost on reload');
  expect(await page.getByLabel('Display currency').inputValue() === 'USD', 'currency lost');
  expect(await page.getByRole('switch', { name: 'Budget alerts' }).getAttribute('aria-checked') === 'false', 'notification pref lost');
  await nav('Dashboard');
  await page.waitForTimeout(500);
  const t = await page.locator('main').innerText();
  expect(t.includes('$') && !t.includes('₹'), `currency not applied: ${t.slice(0, 300)}`);
  await shot('10-dashboard-light-usd');
});

await step('settings: opening balance is saved and included in the balance', async () => {
  await nav('Settings');
  await page.getByLabel(/^Opening balance/).fill('1,000');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText('Profile saved.').waitFor();
  await page.getByLabel(/^Opening balance/).fill('abc');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText(/valid number/).waitFor();
  await page.getByLabel(/^Opening balance/).fill('1000');
  await nav('Dashboard');
  await page.getByText(/Includes opening balance of \$1,000/).waitFor();
});

await step('settings: add/rename category, in-use category cannot be deleted, change password, export', async () => {
  await nav('Settings');
  await page.getByRole('button', { name: 'Add category' }).click();
  await dialog().getByLabel('Name').fill('Pets');
  await dialog().getByRole('button', { name: 'Save' }).click();
  await page.getByText('Category saved.').waitFor();
  await page.getByRole('button', { name: 'Delete Transport' }).click();
  await dialog().getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText(/has transactions/).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export my data/ }).click()]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(exported.transactions?.length === 4, `export has ${exported.transactions?.length} transactions`);
  expect(!JSON.stringify(exported).includes('password_hash') && !JSON.stringify(exported).includes('scrypt'), 'export leaks hash');
  await page.getByLabel('Current password', { exact: true }).fill(A.password);
  await page.getByLabel('New password', { exact: true }).fill('Brand-New-Pass-5');
  await page.getByLabel('Confirm new password').fill('Brand-New-Pass-5');
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByText(/Password changed/).waitFor();
  A.password = 'Brand-New-Pass-5';
});

await step('mobile: hamburger menu opens, navigates and closes; no horizontal overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard`);
  const burger = page.getByRole('button', { name: 'Open menu' });
  await burger.waitFor();
  expect(!(await page.locator('#sidebar').evaluate((n) => n.getBoundingClientRect().right > 10)), 'sidebar visible before opening');
  await burger.click();
  expect(await page.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded') === 'true', 'aria-expanded');
  await page.waitForTimeout(400);
  await shot('11-mobile-menu');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Budgets' }).click();
  await page.getByRole('heading', { name: 'Budgets', exact: true }).waitFor();
  await page.waitForTimeout(400);
  expect(await page.locator('#sidebar').evaluate((n) => n.getBoundingClientRect().right <= 10), 'sidebar did not close after navigating');
  for (const p of ['dashboard', 'transactions', 'analytics', 'budgets', 'goals', 'smartsave', 'settings']) {
    await page.goto(`${BASE}/${p}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over <= 1, `/${p} overflows horizontally by ${over}px`);
    await shot(`12-mobile-${p}`);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
});

await step('sign out, then wrong password gives a generic error', async () => {
  await page.goto(`${BASE}/dashboard`);
  await signOut();
  await signIn({ email: A.email, password: 'Wrong-Password-1' });
  await page.getByText(/incorrect|invalid/i).first().waitFor();
});

await step('user B is isolated from user A', async () => {
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Name').fill(B.name); await page.getByLabel('Email').fill(B.email); await page.getByLabel('Password', { exact: true }).fill(B.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Nothing here yet').waitFor();
  await nav('Transactions'); await page.getByText('No transactions yet').waitFor();
  await nav('Savings Goals'); await page.getByText('No goals yet').waitFor();
  await nav('Budgets'); await page.getByText('No monthly budget').waitFor();
  await nav('Settings');
  await page.getByRole('heading', { name: 'Expense categories' }).waitFor();
  const t = await page.locator('main').innerText();
  expect(!t.includes('Pets'), "B can see A's category");
  // direct API access with B's cookie to A's data is impossible; list endpoints only return B's rows
  const r = await page.evaluate(async () => (await fetch('/api/transactions', { headers: { 'X-Requested-With': 'aurora-finsight' } })).json());
  expect(r.total === 0, `B sees ${r.total} transactions`);
  await signOut();
});

await step('user A signs back in: data persisted, new password works', async () => {
  await signIn(A);
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening|night), Asha/ }).waitFor();
  await nav('Transactions');
  await page.getByText('4 transactions').waitFor();
  await nav('Savings Goals');
  await page.getByRole('heading', { name: 'Laptop' }).waitFor();
});

await step('expired/invalid session sends the user to sign-in', async () => {
  await ctx.clearCookies();
  await page.evaluate(() => fetch('/api/transactions', { headers: { 'X-Requested-With': 'aurora-finsight' } }));
  await page.goto(`${BASE}/transactions`);
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
});

await step('unknown routes show a not-found page when signed in', async () => {
  await signIn(A);
  await page.getByRole('heading', { name: /Good/ }).waitFor();
  await page.goto(`${BASE}/no-such-page`);
  await page.getByText('Page not found').waitFor();
});

const real = problems.filter((p) => !/favicon/i.test(p) && !/ERR_ABORTED/.test(p) && !/status of 401|status of 409|status of 422|status of 400|Failed to load resource/.test(p));
await step('no unexpected page errors or failed requests', async () => { expect(real.length === 0, real.join('\n')); });
await browser.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (problems.length) console.log(`(informational: ${problems.length} browser console messages; first: ${problems[0]})`);
process.exit(failures.length ? 1 : 0);
