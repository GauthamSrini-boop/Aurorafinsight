import { ApiError } from '../lib/errors.js';

/** Conservative security headers for the API and the bundled client. */
export function securityHeaders({ isProd }) {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
        "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
      ].join('; '),
    });
    if (isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions, in two layers:
 *  1. state-changing requests must carry a custom header, which browsers will
 *     not let a cross-site form or image send (and cross-site fetch is blocked
 *     by CORS preflight, which this server never approves);
 *  2. if an Origin header is present it must match this host or an allowed origin.
 */
export function csrfProtection({ allowedOrigins = [] }) {
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    if (req.get('x-requested-with') !== 'aurora-finsight') {
      return next(new ApiError(403, 'csrf', 'Missing or invalid request header.'));
    }
    const origin = req.get('origin');
    if (origin) {
      let ok = allowedOrigins.includes(origin);
      try { ok = ok || new URL(origin).host === req.get('host'); } catch { ok = false; }
      if (!ok) return next(new ApiError(403, 'csrf', 'Cross-site request blocked.'));
    }
    return next();
  };
}
