import DOMPurify from 'dompurify';

/**
 * Sanitize a free-text user input before it leaves the browser (Feature 4).
 *
 * Trims surrounding whitespace and strips any HTML/script payload via
 * DOMPurify so stored-XSS vectors never reach the backend or get echoed
 * back into the DOM. Non-string values pass through untouched so callers can
 * apply this blindly without breaking numbers, dates, or booleans.
 *
 * Use this ONLY on free-text fields (names, descriptions, chat messages).
 * Do NOT apply to number inputs, date inputs, or dropdown/enum values.
 *
 * @param {unknown} str
 * @returns {unknown} sanitized string, or the original value if not a string
 */
export const sanitizeInput = (str) => {
  if (typeof str !== 'string') return str;
  return DOMPurify.sanitize(str.trim());
};

export default sanitizeInput;
