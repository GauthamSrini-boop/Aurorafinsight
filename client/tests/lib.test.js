import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseOptionalAmount, parseSignedAmount, minorToInput, formatMoney, compactMoney, percent } from '../src/lib/money.js';
import { todayIn, addMonths, monthLabel, formatDate, addDays, relativeDay } from '../src/lib/dates.js';
import { niceMax, donutSegments, ticks } from '../src/lib/chart.js';

test('parseAmount converts text to exact minor units', () => {
  const ok = (s, minor) => assert.deepEqual(parseAmount(s), { minor }, s);
  ok('250', 25000); ok('250.5', 25050); ok('250.50', 25050); ok('0.1', 10); ok('0.07', 7); ok('.5', 50);
  ok('1,234.56', 123456); ok('12,34,567', 123456700); ok('₹ 1,000', 100000); ok('19.99', 1999);
  ok('1000000000.00', 100_000_000_000);
  for (const bad of ['', '  ', 'abc', '-5', '0', '0.00', '1.234', '1,2,3', '1.2.3', '.', '1000000000.01', '12e3', '１２']) {
    assert.ok(parseAmount(bad).error, `should reject "${bad}"`);
  }
  // classic float traps stay exact
  assert.equal(parseAmount('1.15').minor, 115);
  assert.equal(parseAmount('8.20').minor, 820);
});

test('parseOptionalAmount allows empty and zero', () => {
  assert.deepEqual(parseOptionalAmount(''), { minor: 0 });
  assert.deepEqual(parseOptionalAmount('0'), { minor: 0 });
  assert.deepEqual(parseOptionalAmount('0.00'), { minor: 0 });
  assert.deepEqual(parseOptionalAmount('12.5'), { minor: 1250 });
  assert.ok(parseOptionalAmount('x').error);
});

test('parseSignedAmount allows zero, empty and negatives', () => {
  assert.deepEqual(parseSignedAmount(''), { minor: 0 });
  assert.deepEqual(parseSignedAmount('-1,250.50'), { minor: -125050 });
  assert.deepEqual(parseSignedAmount('5000'), { minor: 500000 });
  assert.ok(parseSignedAmount('--5').error);
  assert.ok(parseSignedAmount('1.234').error);
  assert.ok(parseSignedAmount('abc').error);
});

test('minorToInput round-trips with parseAmount', () => {
  for (const m of [1, 7, 10, 99, 100, 1999, 123456, 100_000_000_000]) assert.equal(parseAmount(minorToInput(m)).minor, m);
  assert.equal(minorToInput(5), '0.05');
});

test('formatMoney formats by currency and handles negatives', () => {
  assert.equal(formatMoney(123456, 'INR'), '₹1,234.56');
  assert.equal(formatMoney(100000, 'INR'), '₹1,000');
  assert.equal(formatMoney(5, 'USD'), '$0.05');
  assert.equal(formatMoney(-2500, 'USD'), '-$25');
  assert.equal(formatMoney(50000, 'INR'), '₹500');
  assert.equal(formatMoney(50050, 'INR'), '₹500.50');
  assert.equal(formatMoney(100_000_000_000, 'INR'), '₹1,00,00,00,000');
  assert.equal(compactMoney(0, 'INR'), '₹0');
  assert.equal(compactMoney(5000000, 'INR'), '₹50K');
  assert.equal(compactMoney(12500000, 'INR'), '₹1.3L');
  assert.equal(compactMoney(1000000000, 'INR'), '₹1Cr');
  assert.equal(compactMoney(2500000, 'USD'), '$25K');
  assert.equal(compactMoney(123456700, 'USD'), '$1.2M');
  assert.equal(compactMoney(-5000000, 'USD'), '-$50K');
  assert.equal(formatMoney(150000000, 'INR', { compact: true }), '₹15L');
  assert.equal(formatMoney(undefined, 'USD'), '$0');
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(5, 0), 0);
});

test('dates: user-local today, month maths, labels', () => {
  const now = new Date('2026-10-15T20:00:00Z');
  assert.equal(todayIn('Asia/Kolkata', now), '2026-10-16');
  assert.equal(todayIn('America/New_York', now), '2026-10-15');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(monthLabel('2026-03'), 'March 2026');
  assert.equal(formatDate('2026-10-05'), '5 Oct 2026');
  assert.equal(formatDate('2026-10-05', { year: false }), '5 Oct');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(relativeDay('2026-10-15', '2026-10-15'), 'Today');
  assert.equal(relativeDay('2026-10-14', '2026-10-15'), 'Yesterday');
  assert.equal(relativeDay('2026-09-01', '2026-10-15'), '1 Sep');
});

test('chart helpers', () => {
  assert.equal(niceMax(0), 100);
  assert.equal(niceMax(730), 1000);
  assert.equal(niceMax(1900), 2000);
  assert.equal(niceMax(2300), 2500);
  assert.equal(niceMax(4100), 5000);
  assert.deepEqual(ticks(100, 4), [0, 25, 50, 75, 100]);
  const segs = donutSegments([{ value: 1 }, { value: 3 }, { value: 0 }], 10);
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(segs[0].length + segs[1].length - 2 * Math.PI * 10) < 1e-9);
  assert.equal(segs[1].offset, segs[0].length);
});
