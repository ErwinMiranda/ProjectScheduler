

export const DAY_MS = 86400000;

export function toUTC(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0,0,0,0);
  return toUTC(x);
}

export function formatDate(d) {
  return !d || isNaN(d.getTime()) ? "Invalid" : d.toISOString().slice(0,10);
}

export function daysBetween(a, b) {
  return Math.round((b-a)/DAY_MS);
}
