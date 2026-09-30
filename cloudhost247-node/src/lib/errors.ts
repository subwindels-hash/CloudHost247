export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code = 'ERROR') {
    super(message);
    this.name = 'HttpError';
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'This service is temporarily unavailable') {
    super(503, message, 'SERVICE_UNAVAILABLE');
  }
}

export class UpstreamError extends HttpError {
  constructor(message = 'The upstream provider returned an unexpected response') {
    super(502, message, 'UPSTREAM_ERROR');
  }
}
