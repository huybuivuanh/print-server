/**
 * Formats a phone number string
 * @param {string} phone - Phone number string
 * @returns {string} Formatted phone number
 */
function formatPhone(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");

  if (digits.length > 7) {
    return `${digits.slice(0, -7)} ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
  }
  return `${digits.slice(0, -4)}-${digits.slice(-4)}`;
}

function toDateMaybe(ts) {
  if (!ts) return null;

  if (ts instanceof Date) return ts;

  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof ts.toDate === "function") {
    return ts.toDate();
  }

  if (typeof ts.seconds === "number") {
    const ns = typeof ts.nanoseconds === "number" ? ts.nanoseconds : 0;
    return new Date(ts.seconds * 1000 + Math.floor(ns / 1e6));
  }

  if (typeof ts._seconds === "number") {
    const ns = typeof ts._nanoseconds === "number" ? ts._nanoseconds : 0;
    return new Date(ts._seconds * 1000 + Math.floor(ns / 1e6));
  }

  return null;
}

/**
 * Formats a date to locale string
 * @param {Date} date - Date object
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
function formatDate(date, options) {
  if (!date) return "";
  return date.toLocaleString("en-CA", options);
}

module.exports = { formatPhone, toDateMaybe, formatDate };
