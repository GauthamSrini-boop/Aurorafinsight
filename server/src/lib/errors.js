export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, fields, code = 'validation') => new ApiError(400, code, message, fields);
export const unauthorized = (message = 'Please log in to continue.') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that.') => new ApiError(403, 'forbidden', message);
export const notFound = (what = 'Item') => new ApiError(404, 'not_found', `${what} not found.`);
export const conflict = (message, code = 'conflict') => new ApiError(409, code, message);
export const unprocessable = (message, code = 'unprocessable', fields) => new ApiError(422, code, message, fields);
