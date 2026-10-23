import { z } from 'zod';
import { badRequest } from './errors.js';
import { isValidISODate, isValidMonth, isValidTimeZone } from './dates.js';

export const MAX_MINOR = 100_000_000_000;
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
export const THEMES = ['dark', 'light', 'system'];
export const COLORS = ['indigo', 'cyan', 'emerald', 'amber', 'rose', 'violet', 'sky', 'orange', 'slate'];

/** Collapse whitespace and strip control characters. */
export const cleanText = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const text = (label, min, max) =>
  z.string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
    .transform(cleanText)
    .pipe(z.string().min(min, min === 1 ? `${label} is required.` : `${label} is too short.`).max(max, `${label} must be ${max} characters or fewer.`));

const optionalNote = (max, label = 'Note') =>
  z.union([z.string().max(max * 2, `${label} must be ${max} characters or fewer.`).transform(cleanText).pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`)), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

export const email = z.string({ required_error: 'Email is required.' })
  .trim().toLowerCase().max(254, 'Email is too long.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter a valid email address.');

export const amountMinor = z.number({ required_error: 'Amount is required.', invalid_type_error: 'Amount must be a number.' })
  .int('Amount must be a whole number of minor units.').min(1, 'Amount must be greater than 0.').max(MAX_MINOR, 'Amount is too large.');

export const isoDate = z.string({ required_error: 'Date is required.' }).refine(isValidISODate, 'Enter a valid date (YYYY-MM-DD).');
export const month = z.string({ required_error: 'Month is required.' }).refine(isValidMonth, 'Enter a valid month (YYYY-MM).');
const id = z.string().min(1).max(64);
const tz = z.string().refine(isValidTimeZone, 'Unknown time zone.');

export const schemas = {
  register: z.object({
    name: text('Name', 1, 80), email, password: z.string({ required_error: 'Password is required.' }).max(128, 'Password must be 128 characters or fewer.'),
    timezone: tz.optional(),
  }).strict(),
  login: z.object({ email, password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.').max(128) }).strict(),

  profilePatch: z.object({
    name: text('Name', 1, 80).optional(),
    currency: z.enum(CURRENCIES, { errorMap: () => ({ message: 'Unsupported currency.' }) }).optional(),
    theme: z.enum(THEMES, { errorMap: () => ({ message: 'Unsupported theme.' }) }).optional(),
    timezone: tz.optional(),
    openingBalanceMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR).optional(),
    notifications: z.object({ budget: z.boolean().optional(), goals: z.boolean().optional(), tips: z.boolean().optional() }).strict().optional(),
  }).strict(),
  passwordChange: z.object({ currentPassword: z.string().min(1, 'Current password is required.').max(128), newPassword: z.string().max(128, 'Password must be 128 characters or fewer.') }).strict(),
  accountDelete: z.object({ password: z.string().min(1, 'Password is required.').max(128) }).strict(),

  categoryCreate: z.object({
    name: text('Name', 1, 40), kind: z.enum(['expense', 'income']), color: z.enum(COLORS).optional(), flexible: z.boolean().optional(),
  }).strict(),
  categoryPatch: z.object({ name: text('Name', 1, 40).optional(), color: z.enum(COLORS).optional(), flexible: z.boolean().optional() }).strict(),

  transactionCreate: z.object({
    kind: z.enum(['expense', 'income'], { errorMap: () => ({ message: 'Choose expense or income.' }) }),
    title: text('Description', 1, 120), amountMinor, categoryId: id, date: isoDate, note: optionalNote(500), paymentMethod: optionalNote(40, 'Payment method'),
  }).strict(),
  transactionPatch: z.object({
    kind: z.enum(['expense', 'income']).optional(), title: text('Description', 1, 120).optional(), amountMinor: amountMinor.optional(),
    categoryId: id.optional(), date: isoDate.optional(), note: optionalNote(500), paymentMethod: optionalNote(40, 'Payment method'),
  }).strict(),
  transactionQuery: z.object({
    q: z.string().max(100).optional(), type: z.enum(['expense', 'income']).optional(), categoryId: id.optional(),
    minAmount: z.string().regex(/^\d{1,12}$/, 'Minimum amount must be a whole number of minor units.').optional(),
    maxAmount: z.string().regex(/^\d{1,12}$/, 'Maximum amount must be a whole number of minor units.').optional(),
    paymentMethod: z.string().max(40).optional(),
    from: isoDate.optional(), to: isoDate.optional(),
    year: z.string().regex(/^\d{4}$/, 'Year must be 4 digits.').optional(), month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'Month must be 1–12.').optional(),
    sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
    limit: z.string().regex(/^\d{1,3}$/).optional(), offset: z.string().regex(/^\d{1,7}$/).optional(),
  }).strict(),

  budgetPut: z.object({ month, categoryId: id.nullable().optional(), amountMinor }).strict(),
  monthQuery: z.object({ month: month.optional() }).strict(),
  analyticsQuery: z.object({ month: month.optional(), categoryId: id.optional() }).strict(),
  smartsaveTarget: z.object({ targetMinor: z.number().int().min(0).max(MAX_MINOR).nullable() }).strict(),
  yearQuery: z.object({ year: z.string().regex(/^\d{4}$/, 'Year must be 4 digits.').optional() }).strict(),

  goalCreate: z.object({
    name: text('Goal name', 1, 80), targetMinor: amountMinor, deadline: isoDate.nullable().optional(),
    savedMinor: z.number().int().min(0).max(MAX_MINOR).optional(),
    description: optionalNote(300, 'Description'), category: optionalNote(40, 'Category'),
  }).strict(),
  goalPatch: z.object({
    name: text('Goal name', 1, 80).optional(), targetMinor: amountMinor.optional(), deadline: isoDate.nullable().optional(),
    description: optionalNote(300, 'Description'), category: optionalNote(40, 'Category'), archived: z.boolean().optional(),
  }).strict(),
  contribution: z.object({ amountMinor, date: isoDate.optional(), note: optionalNote(200) }).strict(),
};

/** Validate and return parsed data, or throw a 400 with per-field messages. */
export function validate(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.code === 'unrecognized_keys' ? `Unknown field: ${issue.keys.join(', ')}.` : issue.message;
  }
  throw badRequest(Object.values(fields)[0] || 'Invalid request.', fields);
}
