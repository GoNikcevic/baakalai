/**
 * Route parameter validation middleware.
 * Validates :id and other params before they reach handlers.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_REGEX = /^\d+$/;
const SLUG_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that :id param is a valid UUID or numeric ID.
 */
function validateId(req, res, next) {
  const { id } = req.params;
  if (!id) return next();
  if (UUID_REGEX.test(id) || NUMERIC_REGEX.test(id)) return next();
  return res.status(400).json({ error: 'Invalid ID format' });
}

/**
 * Validate that a named param matches a whitelist of allowed values.
 * Usage: validateEnum('provider', ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'])
 */
function validateEnum(paramName, allowedValues) {
  return (req, res, next) => {
    const val = req.params[paramName];
    if (!val) return next();
    if (allowedValues.includes(val.toLowerCase())) return next();
    return res.status(400).json({ error: `Invalid ${paramName}: ${val}` });
  };
}

/**
 * Validate that a named param is a safe slug (alphanumeric + dash + underscore).
 */
function validateSlug(paramName) {
  return (req, res, next) => {
    const val = req.params[paramName];
    if (!val) return next();
    if (SLUG_REGEX.test(val)) return next();
    return res.status(400).json({ error: `Invalid ${paramName} format` });
  };
}

module.exports = { validateId, validateEnum, validateSlug };
