'use strict';

const path = require('node:path');

function normalizeProject(value) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) return null;
  const windows = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
  if (!windows && !path.posix.isAbsolute(value)) return null;
  let normalized = (windows ? path.win32 : path.posix).normalize(value).replace(/\\/g, '/');
  if (windows) normalized = normalized.toLowerCase();
  return normalized.replace(/\/+$/, '') || '/';
}

function belongsToWorkspace(cwd, roots, includeSubfolders = true) {
  const project = normalizeProject(cwd);
  if (!project) return false;
  return roots.some(root => {
    const normalizedRoot = normalizeProject(root);
    return normalizedRoot && (project === normalizedRoot ||
      (includeSubfolders && project.startsWith(normalizedRoot === '/' ? '/' : normalizedRoot + '/')));
  });
}

function filterSessions(sessions, { roots = [], scope = 'workspace', includeSubfolders = true, query = '' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return sessions.filter(session => normalizeProject(session.cwd) &&
    (scope === 'all' || belongsToWorkspace(session.cwd, roots, includeSubfolders)) &&
    (!search || `${session.title} ${session.provider} ${session.cwd}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

function safeSessionId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function resumeSpec(session, executables = {}) {
  if (!session || !safeSessionId(session.id) || !normalizeProject(session.cwd)) throw new Error('Invalid session metadata.');
  if (!['codex', 'claude'].includes(session.provider)) throw new Error('Unsupported provider.');
  return {
    executable: executables[session.provider] || session.provider,
    args: [session.provider === 'codex' ? 'resume' : '--resume', session.id],
    cwd: session.cwd
  };
}

module.exports = { normalizeProject, belongsToWorkspace, filterSessions, safeSessionId, resumeSpec };
