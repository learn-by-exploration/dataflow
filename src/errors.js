'use strict';

class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AppError';
  }
}

class NotFoundError extends AppError {
  constructor(resource, id) {
    const msg = id !== null && id !== undefined ? `${resource} ${id} not found` : `${resource} not found`;
    super('NOT_FOUND', msg, 404);
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, 400);
    this.details = details;
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403);
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super('CONFLICT', message, 409);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

module.exports = { AppError, NotFoundError, ValidationError, ForbiddenError, ConflictError, UnauthorizedError };
