#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { parseArgs } = require('node:util');
const { createProviders, listProviders } = require('../src/providers.cjs');
const { filterSessions } = require('../src/scope.cjs');
async function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', multiple: true }, all: { type: 'boolean' },
    'codex-home': { type: 'string' }, 'claude-home': { type: 'string' },
    provider: { type: 'string' }, counts: { type: 'boolean' }
  } });
  if (values.provider && !['codex', 'claude'].includes(values.provider)) throw new Error('Provider must be codex or claude.');
  const providers = createProviders({ codexHome: values['codex-home'], claudeHome: values['claude-home'] });
  const result = await listProviders(providers.filter(provider => !values.provider || provider.id === values.provider));
  const sessions = filterSessions(result.sessions, { roots: (values.workspace || [process.cwd()]).map(root => path.resolve(root)), scope: values.all ? 'all' : 'workspace' });
  const output = values.counts ? { count: sessions.length, providers: Object.fromEntries(providers.map(provider => [provider.id, sessions.filter(session => session.provider === provider.id).length])) } : { sessions };
  console.log(JSON.stringify({ ...output, errors: result.errors }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
