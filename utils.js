// utils.js — Shared helper functions

// Milliseconds in a day
export const DAY_MS = 86400000;

/**
 * Converts date to UTC-normalized (avoids timezone drift)
 */
export function toUTC(d) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Adds N days to a date, preserving calendar date
 */
export function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    x.setHours(0, 0, 0, 0);
    return toUTC(x);
}

/**
 * Human-friendly YYYY-MM-DD output
 */
export function formatDate(d) {
    return !d || isNaN(d.getTime())
        ? "Invalid"
        : d.toISOString().slice(0, 10);
}

/**
 * Exact day difference between two UTC-safe dates
 */
export function daysBetween(a, b) {
    return Math.round((b - a) / DAY_MS);
}
