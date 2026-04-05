'use strict';

const { ValidationError } = require('../errors');

/**
 * Create a Zod validation middleware.
 * @param {object} schemas - { body?, params?, query? } each a Zod schema
 */
function validate(schemas) {
  return (req, _res, next) => {
    const errors = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push(...result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })));
      } else {
        req.body = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push(...result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })));
      } else {
        req.params = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push(...result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })));
      } else {
        try {
          req.query = result.data;
        } catch {
          req._parsedQuery = result.data;
        }
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError('Validation failed', errors));
    }

    next();
  };
}

module.exports = validate;
