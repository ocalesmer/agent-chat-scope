'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { CodexProvider, ClaudeProvider, createProviders, listProviders, prefixRows } = require('../src/providers.cjs');
const { filterSessions } = require('../src/scope.cjs');
const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-chat-scope-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}
async function write(home, relative, rows) {
  const file = path.join(home, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
  return file;
}
const codex = (id, cwd, extra = {}) => ({ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id, cwd, source: 'vscode', ...extra } });
const claude = (sessionId, cwd, extra = {}) => ({ type: 'user', sessionId, cwd, ...extra });

test('absent providers return an empty result without errors', async t => {
  const home = await fixture(t);
  assert.deepEqual(await listProviders(createProviders({ codexHome: path.join(home, 'codex'), claudeHome: path.join(home, 'claude') })), { sessions: [], errors: [] });
});
test('Codex joins titles by ID and scope uses recorded cwd', async t => {
  const home = await fixture(t);
  await write(home, 'sessions/2026/01/01/a.jsonl', [codex(one, '/work/alpha')]);
  await write(home, 'sessions/2026/01/01/b.jsonl', [codex(two, '/work/alpha-archive')]);
  await write(home, 'session_index.jsonl', [{ id: one, thread_name: 'Old name', updated_at: '2026-01-01' }, { id: one, thread_name: 'New name', updated_at: '2026-01-03' }, '{unfinished']);
  const sessions = await new CodexProvider(home).list();
  assert.equal(sessions.length, 2);
  const scoped = filterSessions(sessions, { roots: ['/work/alpha'] });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].title, 'New name');
});
test('Codex ignores archived sessions, malformed metadata and subagents', async t => {
  const home = await fixture(t);
  await write(home, 'archived_sessions/a.jsonl', [codex(one, '/work/alpha')]);
  await write(home, 'sessions/sub.jsonl', [codex(two, '/work/alpha', { source: { subagent: 'review' } })]);
  await write(home, 'sessions/no-cwd.jsonl', [codex(one, undefined)]);
  await write(home, 'sessions/broken.jsonl', ['{broken']);
  assert.deepEqual(await new CodexProvider(home).list(), []);
});
test('Codex refresh invalidates changed titles and removes deleted sessions', async t => {
  const home = await fixture(t);
  const file = await write(home, 'sessions/a.jsonl', [codex(one, '/work/alpha')]);
  const provider = new CodexProvider(home);
  assert.equal((await provider.list()).length, 1);
  await write(home, 'session_index.jsonl', [{ id: one, thread_name: 'Renamed', updated_at: '2026-01-04' }]);
  assert.equal((await provider.list())[0].title, 'Renamed');
  await fs.unlink(file);
  assert.deepEqual(await provider.list(), []);
  assert.equal(provider.cache.size, 0);
});
test('Claude resolves project identity from cwd instead of encoded folder names', async t => {
  const home = await fixture(t);
  await write(home, 'projects/-work-alpha/a.jsonl', [claude(one, '/work/beta')]);
  const provider = new ClaudeProvider(home);
  const sessions = await provider.list();
  assert.equal(sessions.length, 1);
  assert.deepEqual(filterSessions(sessions, { roots: ['/work/alpha'] }), []);
  assert.equal(filterSessions(sessions, { roots: ['/work/beta'] }).length, 1);
});
test('Claude supports title indexes, transcript titles and malformed append recovery', async t => {
  const home = await fixture(t);
  await write(home, 'projects/project/a.jsonl', ['{partial', claude(one, '/work/alpha'), { type: 'custom-title', sessionId: one, customTitle: 'Named\nconversation' }]);
  await write(home, 'projects/project/b.jsonl', [claude(two, '/work/beta')]);
  await fs.writeFile(path.join(home, 'projects/project/sessions-index.json'), JSON.stringify({ entries: [
    { sessionId: one, summary: 'Old summary' }, { sessionId: two, summary: 'Indexed name', modified: '2026-01-05' }
  ] }));
  const sessions = await new ClaudeProvider(home).list();
  assert.equal(sessions.find(row => row.id === one).title, 'Named conversation');
  assert.equal(sessions.find(row => row.id === two).title, 'Indexed name');
});
test('Claude skips sidechains, nested subagent files and stale index-only records', async t => {
  const home = await fixture(t);
  await write(home, 'projects/project/a.jsonl', [claude(one, '/work/alpha', { isSidechain: true })]);
  await write(home, 'projects/project/subagents/b.jsonl', [claude(two, '/work/alpha')]);
  await fs.writeFile(path.join(home, 'projects/project/sessions-index.json'), JSON.stringify({ entries: [{ sessionId: two, projectPath: '/work/alpha' }] }));
  assert.deepEqual(await new ClaudeProvider(home).list(), []);
});
test('a failed provider does not hide healthy provider results or expose error paths', async () => {
  const result = await listProviders([
    { id: 'codex', list: async () => [{ key: 'codex:1' }] },
    { id: 'claude', list: async () => { const error = new Error('/private/path'); error.code = 'EACCES'; throw error; } }
  ]);
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.errors, [{ provider: 'claude', code: 'EACCES' }]);
});
test('metadata prefix reads stay bounded and ignore a truncated final line', async t => {
  const home = await fixture(t);
  const file = await write(home, 'large.jsonl', [{ type: 'first' }, { payload: 'a'.repeat(10000) }]);
  assert.deepEqual(await prefixRows(file, 128), [{ type: 'first' }]);
});
test('identical IDs from different providers remain distinct', async t => {
  const home = await fixture(t);
  await write(home, 'codex/sessions/a.jsonl', [codex(one, '/work/alpha')]);
  await write(home, 'claude/projects/project/a.jsonl', [claude(one, '/work/alpha')]);
  const result = await listProviders([new CodexProvider(path.join(home, 'codex')), new ClaudeProvider(path.join(home, 'claude'))]);
  assert.equal(result.sessions.length, 2);
  assert.notEqual(result.sessions[0].key, result.sessions[1].key);
});
