// Tiny dependency-free test harness that runs in the browser (real IndexedDB, Intl and canvas).
const tests = [];

export function test(name, fn) { tests.push({ name, fn }); }

export class AssertionError extends Error {}

export function assert(condition, message = 'Assertion failed') {
  if (!condition) throw new AssertionError(message);
}

export function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
}

export async function assertRejects(promiseOrFn, check = {}, message = '') {
  let error = null;
  try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn); } catch (err) { error = err; }
  if (!error) throw new AssertionError(`${message || 'Expected rejection'}: promise resolved`);
  if (check.code && error.code !== check.code) throw new AssertionError(`${message || 'Wrong error'}: expected code ${check.code}, got ${error.code} (${error.message})`);
  if (check.match && !check.match.test(error.message)) throw new AssertionError(`${message || 'Wrong message'}: "${error.message}" does not match ${check.match}`);
  return error;
}

export const hasIssue = (issues, path, pattern, severity = 'error') =>
  issues.some(i => i.path === path && i.severity === severity && (!pattern || pattern.test(i.message)));

export function assertIssue(issues, path, pattern, severity = 'error') {
  if (!hasIssue(issues, path, pattern, severity)) {
    throw new AssertionError(`Expected ${severity} at "${path}"${pattern ? ` matching ${pattern}` : ''}. Got: ${JSON.stringify(issues.map(i => `${i.severity}@${i.path}: ${i.message}`))}`);
  }
}

export function assertNoErrors(issues, message = 'Expected no errors') {
  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length) throw new AssertionError(`${message}: ${JSON.stringify(errors.map(i => `${i.path}: ${i.message}`))}`);
}

export async function run(output) {
  const results = [];
  for (const { name, fn } of tests) {
    const started = performance.now();
    try {
      await fn();
      results.push({ name, ok: true, ms: Math.round(performance.now() - started) });
    } catch (err) {
      results.push({ name, ok: false, error: `${err.name}: ${err.message}`, ms: Math.round(performance.now() - started) });
    }
    output?.(results.at(-1));
  }
  return results;
}
