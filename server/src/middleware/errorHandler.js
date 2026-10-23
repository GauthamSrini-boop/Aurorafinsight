import { ApiError } from '../lib/errors.js';

export function notFoundApi(req, res, next) {
  next(new ApiError(404, 'not_found', 'Endpoint not found.'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler({ log = console.error } = {}) {
  // Express identifies error handlers by their four-argument signature.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return;
    let status = 500;
    let body = { error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } };
    if (err instanceof ApiError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'bad_json', message: 'The request body is not valid JSON.' } };
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { error: { code: 'too_large', message: 'The request is too large.' } };
    } else {
      log(`[error] ${req.method} ${req.path}:`, err);
    }
    res.status(status).json(body);
  };
}
