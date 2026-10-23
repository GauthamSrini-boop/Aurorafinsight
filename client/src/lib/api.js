export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }
}

let onUnauthorized = () => {};
/** The auth context registers here so an expired session sends the user back to sign-in. */
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

async function request(method, path, body, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'aurora-finsight', // CSRF guard required by the server on every request
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  if (raw && res.ok) return res;
  let data;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!res.ok) {
    const e = data?.error;
    const err = new ApiError(res.status, e?.code ?? 'error', e?.message ?? (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.'), e?.fields);
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized(err);
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  delete: (p, b) => request('DELETE', p, b),
  download: (p) => request('GET', p, undefined, { raw: true }),
};
