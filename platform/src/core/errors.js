/**
 * HTTP error hierarchy.
 *
 * Ported 1:1 from cloudhost247-node/src/lib/errors.ts so error codes stay wire-compatible with
 * the existing Fastify platform during the migration. Any error thrown from a domain handler that
 * is an instance of HttpError is serialised by src/core/http.js as { error, message } with the
 * matching status code.
 */
'use strict';

class HttpError extends Error {
  constructor(statusCode, message, code = 'ERROR', details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    const body = { error: this.code, message: this.message };
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

class ValidationError extends HttpError {
  constructor(message = 'Invalid request', details) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends HttpError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends HttpError {
  constructor(message = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

class ConflictError extends HttpError {
  constructor(message) {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

class PayloadTooLargeError extends HttpError {
  constructor(message = 'Request body too large') {
    super(413, message, 'PAYLOAD_TOO_LARGE');
    this.name = 'PayloadTooLargeError';
  }
}

class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests', details) {
    super(429, message, 'RATE_LIMITED', details);
    this.name = 'TooManyRequestsError';
  }
}

class UpstreamError extends HttpError {
  constructor(message = 'The upstream provider returned an unexpected response') {
    super(502, message, 'UPSTREAM_ERROR');
    this.name = 'UpstreamError';
  }
}

class ServiceUnavailableError extends HttpError {
  constructor(message = 'This service is temporarily unavailable') {
    super(503, message, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}

module.exports = {
  HttpError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  TooManyRequestsError,
  UpstreamError,
  ServiceUnavailableError,
};
