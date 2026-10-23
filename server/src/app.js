import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { loadConfig } from './config.js';
import { securityHeaders, csrfProtection } from './middleware/security.js';
import { errorHandler, notFoundApi } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { authRoutes } from './routes/auth.js';
import { profileRoutes } from './routes/profile.js';
import { categoryRoutes } from './routes/categories.js';
import { transactionRoutes } from './routes/transactions.js';
import { budgetRoutes } from './routes/budgets.js';
import { goalRoutes } from './routes/goals.js';
import { analyticsRoutes } from './routes/analytics.js';

/**
 * Builds the Express app. `db` must already be migrated. `clock` is injectable
 * so tests can control "today".
 */
export function createApp({ db, config = loadConfig(), clock = () => new Date(), log = console.error } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', true);

  const limiters = {};
  const ctx = { db, config, clock, limiters };

  app.use(securityHeaders({ isProd: config.isProd }));
  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', csrfProtection({ allowedOrigins: config.allowedOrigins }));

  limiters.api = createRateLimiter({ windowMs: 60_000, max: 600, key: (req) => req.ip });
  app.use('/api', limiters.api);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes(ctx));

  const auth = requireAuth(ctx);
  app.use('/api/profile', auth, profileRoutes(ctx));
  app.use('/api/categories', auth, categoryRoutes(ctx));
  app.use('/api/transactions', auth, transactionRoutes(ctx));
  app.use('/api/budgets', auth, budgetRoutes(ctx));
  app.use('/api/goals', auth, goalRoutes(ctx));
  const insights = analyticsRoutes(ctx);
  for (const base of ['/api/dashboard', '/api/analytics', '/api/smartsave']) app.use(base, auth);
  app.use('/api', insights);

  app.use('/api', notFoundApi);

  // Serve the built client (single-page app) when it exists.
  if (fs.existsSync(path.join(config.clientDir, 'index.html'))) {
    app.use(express.static(config.clientDir, { maxAge: config.isProd ? 7 * 86_400_000 : 0 }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile('index.html', { root: config.clientDir }, (err) => err && next(err));
    });
  }

  app.use(errorHandler({ log }));
  app.ctx = ctx;
  return app;
}
