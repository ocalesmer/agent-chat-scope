'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProject, belongsToWorkspace, filterSessions, resumeSpec } = require('../src/scope.cjs');
const id = '11111111-1111-4111-8111-111111111111';

test('normalizes Windows case, separators, dot segments, and trailing separators', () => {
  assert.equal(normalizeProject('C:\\Projects\\Alpha\\src\\..\\'), 'c:/projects/alpha');
  assert.equal(normalizeProject('C:/PROJECTS/ALPHA'), 'c:/projects/alpha');
});
test('preserves POSIX case and normalizes dot segments', () => {
  assert.equal(normalizeProject('/work/Alpha/./src/..'), '/work/Alpha');
  assert.equal(belongsToWorkspace('/work/alpha', ['/work/Alpha']), false);
});
test('rejects relative, missing, and control-character paths', () => {
  for (const value of ['', null, 'relative/path', 'C:relative', '/work/one\nother']) assert.equal(normalizeProject(value), null);
});
test('requires a path-component boundary', () => {
  assert.equal(belongsToWorkspace('/work/alpha-archive', ['/work/alpha']), false);
  assert.equal(belongsToWorkspace('/work/alpha/src', ['/work/alpha']), true);
});
test('supports exact-only scope and multiple workspace roots', () => {
  assert.equal(belongsToWorkspace('/work/beta', ['/work/alpha', '/work/beta'], false), true);
  assert.equal(belongsToWorkspace('/work/alpha/src', ['/work/alpha'], false), false);
});
test('handles filesystem and UNC roots', () => {
  assert.equal(belongsToWorkspace('/work/alpha', ['/']), true);
  assert.equal(belongsToWorkspace('C:/work/alpha', ['C:/']), true);
  assert.equal(belongsToWorkspace('\\\\SERVER\\Share\\alpha', ['\\\\server\\share']), true);
});
test('workspace mode with no open folder returns no conversations', () => {
  assert.deepEqual(filterSessions([{ key: 'one', cwd: '/work/alpha', title: 'Fix', updatedAt: 1 }]), []);
});
test('All projects is explicit and still excludes missing project metadata', () => {
  const sessions = [{ key: 'a', cwd: '/work/a', updatedAt: 1 }, { key: 'b', cwd: '/work/b', updatedAt: 2 }, { key: 'c', updatedAt: 3 }];
  assert.deepEqual(filterSessions(sessions, { scope: 'all' }).map(row => row.key), ['b', 'a']);
});
test('search is case-insensitive and combines with project scope', () => {
  const sessions = [
    { key: 'a', cwd: '/work/a', provider: 'codex', title: 'Fix login', updatedAt: 1 },
    { key: 'b', cwd: '/work/b', provider: 'claude', title: 'Fix login', updatedAt: 2 }
  ];
  assert.deepEqual(filterSessions(sessions, { roots: ['/work/a'], query: 'LOGIN' }).map(row => row.key), ['a']);
});
test('resumes each provider using an argument array in the original directory', () => {
  assert.deepEqual(resumeSpec({ id, provider: 'codex', cwd: '/work/project with spaces' }), { executable: 'codex', args: ['resume', id], cwd: '/work/project with spaces' });
  assert.deepEqual(resumeSpec({ id, provider: 'claude', cwd: '/work/a' }, { claude: '/tools/claude' }), { executable: '/tools/claude', args: ['--resume', id], cwd: '/work/a' });
});
test('rejects option or shell text in session IDs and unknown providers', () => {
  for (const invalid of ['--help', 'abc; echo unsafe', '../../other', '']) assert.throws(() => resumeSpec({ id: invalid, provider: 'codex', cwd: '/work/a' }));
  assert.throws(() => resumeSpec({ id, provider: 'unknown', cwd: '/work/a' }));
});
