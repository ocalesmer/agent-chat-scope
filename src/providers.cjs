'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { normalizeProject, safeSessionId } = require('./scope.cjs');

const PREFIX_BYTES = 1024 * 1024;

async function entries(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function* sessionFiles(directory, depth = 0) {
  for (const entry of await entries(directory)) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && depth < 5 && !['subagents', 'tool-results'].includes(entry.name)) {
      yield* sessionFiles(file, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
  }
}

// Bounded metadata reads: never load an entire conversation into memory.
async function prefixRows(file, maxBytes = PREFIX_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (bytesRead === maxBytes) lines.pop();
    return lines.flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } finally { await handle.close(); }
}

function title(value, fallback) {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    : fallback;
}

function timestamp(value, fallback) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : fallback;
}

class LocalProvider {
  constructor(id, home) { this.id = id; this.home = home; this.cache = new Map(); }
  async metadata(file, parser) {
    const stat = await fs.stat(file);
    const cached = this.cache.get(file);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const value = parser(await prefixRows(file), stat);
    this.cache.set(file, { mtime: stat.mtimeMs, size: stat.size, value });
    return value;
  }
}

class CodexProvider extends LocalProvider {
  constructor(home) { super('codex', home); }
  async list() {
    const names = new Map();
    // The small local title index is a JSONL stream, not a source of project identity.
    const indexPath = path.join(this.home, 'session_index.jsonl');
    const { createReadStream } = require('node:fs');
    const { createInterface } = require('node:readline');
    try {
      await fs.access(indexPath);
      const input = createReadStream(indexPath, { encoding: 'utf8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          try { const row = JSON.parse(line); if (safeSessionId(row.id)) names.set(row.id, row); } catch { /* In-progress index append. */ }
        }
      } finally { lines.close(); input.destroy(); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const sessions = [];
    const seen = new Set();
    for await (const file of sessionFiles(path.join(this.home, 'sessions'))) {
      seen.add(file);
      try {
        const record = await this.metadata(file, (rows, stat) => {
          const row = rows.find(item => item.type === 'session_meta');
          const meta = row?.payload;
          if (!meta || !safeSessionId(meta.id) || !normalizeProject(meta.cwd)) return null;
          if (typeof meta.source === 'object' && meta.source !== null) return null;
          return { key: `codex:${meta.id}`, provider: 'codex', id: meta.id, cwd: meta.cwd, updatedAt: timestamp(row.timestamp, stat.mtimeMs) };
        });
        if (record) {
          const name = names.get(record.id);
          sessions.push({ ...record, title: title(name?.thread_name, `Codex · ${record.id.slice(0, 8)}`), updatedAt: timestamp(name?.updated_at, record.updatedAt) });
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file);
    return sessions;
  }
}

class ClaudeProvider extends LocalProvider {
  constructor(home) { super('claude', home); }
  async list() {
    const sessions = [];
    const seen = new Set();
    for (const project of await entries(path.join(this.home, 'projects'))) {
      if (!project.isDirectory()) continue;
      const directory = path.join(this.home, 'projects', project.name);
      let index = [];
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(directory, 'sessions-index.json'), 'utf8'));
        index = Array.isArray(parsed.entries) ? parsed.entries : [];
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      const names = new Map(index.filter(row => safeSessionId(row.sessionId)).map(row => [row.sessionId, row]));
      for (const entry of await entries(directory)) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const file = path.join(directory, entry.name);
        seen.add(file);
        try {
          const record = await this.metadata(file, (rows, stat) => {
            const meta = rows.find(row => safeSessionId(row.sessionId) && normalizeProject(row.cwd) && !row.isSidechain);
            if (!meta) return null;
            const label = rows.find(row => row.type === 'custom-title' && row.sessionId === meta.sessionId)?.customTitle;
            return { key: `claude:${meta.sessionId}`, provider: 'claude', id: meta.sessionId, cwd: meta.cwd, title: label, updatedAt: stat.mtimeMs };
          });
          if (record) {
            const name = names.get(record.id);
            sessions.push({ ...record, title: title(record.title || name?.summary || name?.firstPrompt, `Claude · ${record.id.slice(0, 8)}`), updatedAt: timestamp(name?.modified, record.updatedAt) });
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file);
    return sessions;
  }
}

function createProviders(options = {}) {
  const home = options.userHome || os.homedir();
  return [
    new CodexProvider(options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex')),
    new ClaudeProvider(options.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'))
  ];
}

async function listProviders(providers) {
  const results = await Promise.allSettled(providers.map(provider => provider.list()));
  const sessions = new Map();
  const errors = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') for (const session of result.value) sessions.set(session.key, session);
    else errors.push({ provider: providers[i].id, code: result.reason?.code || 'READ_FAILED' });
  });
  return { sessions: [...sessions.values()], errors };
}

module.exports = { CodexProvider, ClaudeProvider, createProviders, listProviders, prefixRows };
