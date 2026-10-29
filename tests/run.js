import { run } from './harness.js';
import './domain.test.js';
import './storage.test.js';

const list = document.getElementById('results');
const results = await run(result => {
  const item = document.createElement('li');
  item.className = result.ok ? 'ok' : 'fail';
  item.textContent = `${result.ok ? '✓' : '✗'} ${result.name} (${result.ms} ms)${result.ok ? '' : `\n   ${result.error}`}`;
  list.append(item);
});
const failed = results.filter(r => !r.ok).length;
document.getElementById('summary').textContent = `${results.length - failed} passed, ${failed} failed, ${results.length} total`;
window.__testResults = { passed: results.length - failed, failed, results };
