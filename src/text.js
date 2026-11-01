'use strict';

/**
 * Removes unsafe control characters and caps free-text input.
 * @param {unknown} s Value to clean.
 * @param {number} max Maximum output length.
 * @returns {string} Cleaned text.
 */
const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Validates and normalizes a planning request.
 * @param {object} [b] Raw request data.
 * @param {Date} [now] Current time, injectable for deterministic validation.
 * @returns {{ok: boolean, errors?: string[], value?: object}} Validation result.
 */
module.exports = { clean };
