'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { AppError, NotFoundError, ValidationError, ForbiddenError, ConflictError, UnauthorizedError } = require('../src/errors');

describe('Error Classes', () => {
  describe('AppError', () => {
    it('creates error with code, message, and status', () => {
      const err = new AppError('TEST_ERROR', 'test message', 422);
      assert.equal(err.code, 'TEST_ERROR');
      assert.equal(err.message, 'test message');
      assert.equal(err.status, 422);
      assert.equal(err.name, 'AppError');
    });

    it('defaults to status 400', () => {
      const err = new AppError('TEST', 'msg');
      assert.equal(err.status, 400);
    });

    it('is an instance of Error', () => {
      const err = new AppError('TEST', 'msg');
      assert.ok(err instanceof Error);
    });
  });

  describe('NotFoundError', () => {
    it('creates 404 error with resource and id', () => {
      const err = new NotFoundError('Item', 42);
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.match(err.message, /Item 42 not found/);
    });

    it('creates message without id', () => {
      const err = new NotFoundError('Category');
      assert.match(err.message, /Category not found/);
    });

    it('handles null id', () => {
      const err = new NotFoundError('Item', null);
      assert.match(err.message, /Item not found/);
    });

    it('is instance of AppError', () => {
      assert.ok(new NotFoundError('X') instanceof AppError);
    });
  });

  describe('ValidationError', () => {
    it('creates 400 error with details', () => {
      const details = [{ field: 'email', message: 'invalid' }];
      const err = new ValidationError('Validation failed', details);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.deepEqual(err.details, details);
    });

    it('is instance of AppError', () => {
      assert.ok(new ValidationError('msg') instanceof AppError);
    });
  });

  describe('ForbiddenError', () => {
    it('creates 403 error', () => {
      const err = new ForbiddenError();
      assert.equal(err.status, 403);
      assert.equal(err.code, 'FORBIDDEN');
      assert.match(err.message, /Access denied/);
    });

    it('accepts custom message', () => {
      const err = new ForbiddenError('No permission');
      assert.equal(err.message, 'No permission');
    });

    it('is instance of AppError', () => {
      assert.ok(new ForbiddenError() instanceof AppError);
    });
  });

  describe('ConflictError', () => {
    it('creates 409 error', () => {
      const err = new ConflictError('Duplicate entry');
      assert.equal(err.status, 409);
      assert.equal(err.code, 'CONFLICT');
      assert.equal(err.message, 'Duplicate entry');
    });

    it('is instance of AppError', () => {
      assert.ok(new ConflictError('msg') instanceof AppError);
    });
  });

  describe('UnauthorizedError', () => {
    it('creates 401 error', () => {
      const err = new UnauthorizedError();
      assert.equal(err.status, 401);
      assert.equal(err.code, 'UNAUTHORIZED');
      assert.match(err.message, /Authentication required/);
    });

    it('accepts custom message', () => {
      const err = new UnauthorizedError('Token expired');
      assert.equal(err.message, 'Token expired');
    });

    it('is instance of AppError', () => {
      assert.ok(new UnauthorizedError() instanceof AppError);
    });
  });
});

describe('Error Handler Middleware', () => {
  it('handles AppError', () => {
    const errorHandler = require('../src/middleware/errors');
    const err = new NotFoundError('Item', 1);
    let statusCode, body;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { body = data; },
    };
    errorHandler(err, { method: 'GET', originalUrl: '/test' }, res, () => {});
    assert.equal(statusCode, 404);
    assert.match(body.error, /Item 1 not found/);
  });

  it('handles ValidationError with details', () => {
    const errorHandler = require('../src/middleware/errors');
    const details = [{ field: 'name', message: 'required' }];
    const err = new ValidationError('Invalid input', details);
    let body;
    const res = {
      status: () => res,
      json: (data) => { body = data; },
    };
    errorHandler(err, { method: 'POST', originalUrl: '/test' }, res, () => {});
    assert.deepEqual(body.details, details);
  });

  it('handles generic error as 500', () => {
    const errorHandler = require('../src/middleware/errors');
    const err = new Error('Something broke');
    let statusCode, body;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { body = data; },
    };
    errorHandler(err, { method: 'GET', originalUrl: '/test' }, res, () => {});
    assert.equal(statusCode, 500);
    assert.equal(body.error, 'Internal server error');
  });

  it('handles SQLite constraint error', () => {
    const errorHandler = require('../src/middleware/errors');
    const err = new Error('SQLITE_CONSTRAINT: UNIQUE constraint');
    let statusCode;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: () => {},
    };
    errorHandler(err, { method: 'POST', originalUrl: '/test' }, res, () => {});
    assert.equal(statusCode, 409);
  });

  it('handles JSON parse error', () => {
    const errorHandler = require('../src/middleware/errors');
    const err = new Error('bad json');
    err.type = 'entity.parse.failed';
    let statusCode, body;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { body = data; },
    };
    errorHandler(err, { method: 'POST', originalUrl: '/test' }, res, () => {});
    assert.equal(statusCode, 400);
    assert.match(body.error, /Invalid JSON/);
  });

  it('does not expose internal error messages', () => {
    const errorHandler = require('../src/middleware/errors');
    const err = new Error('database connection lost');
    let body;
    const res = {
      status: () => res,
      json: (data) => { body = data; },
    };
    errorHandler(err, { method: 'GET', originalUrl: '/test' }, res, () => {});
    assert.equal(body.error, 'Internal server error');
    assert.notEqual(body.error, 'database connection lost');
  });
});

describe('Validation Middleware', () => {
  it('passes valid body through', () => {
    const validate = require('../src/middleware/validate');
    const { z } = require('zod');
    const schema = z.object({ name: z.string() });
    const middleware = validate({ body: schema });
    const req = { body: { name: 'test' } };
    let nextCalled = false;
    middleware(req, {}, (err) => {
      nextCalled = true;
      assert.equal(err, undefined);
    });
    assert.ok(nextCalled);
    assert.equal(req.body.name, 'test');
  });

  it('rejects invalid body', () => {
    const validate = require('../src/middleware/validate');
    const { z } = require('zod');
    const schema = z.object({ name: z.string() });
    const middleware = validate({ body: schema });
    const req = { body: { name: 123 } };
    let error;
    middleware(req, {}, (err) => { error = err; });
    assert.ok(error instanceof ValidationError);
    assert.ok(error.details.length > 0);
  });

  it('validates params', () => {
    const validate = require('../src/middleware/validate');
    const { z } = require('zod');
    const schema = z.object({ id: z.coerce.number().int().positive() });
    const middleware = validate({ params: schema });
    const req = { params: { id: '5' } };
    let nextCalled = false;
    middleware(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(req.params.id, 5);
  });

  it('validates query', () => {
    const validate = require('../src/middleware/validate');
    const { z } = require('zod');
    const schema = z.object({ page: z.coerce.number().default(1) });
    const middleware = validate({ query: schema });
    const req = { query: {} };
    let nextCalled = false;
    middleware(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(req.query.page, 1);
  });
});
