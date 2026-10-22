'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const id = '11111111-1111-4111-8111-111111111111';

async function harness({ folders = ['/work/alpha'] } = {}) {
  const commands = new Map();
  const tasks = [];
  const config = { scope: 'workspace', providers: ['codex', 'claude'] };
  const current = { folders, onConfig: null, onFolders: null, view: null, pick: undefined, input: undefined, clipboard: '' };
  const sessions = [
    { key: 'codex:one', provider: 'codex', id, cwd: '/work/alpha', title: 'Fix login', updatedAt: 100 },
    { key: 'claude:one', provider: 'claude', id, cwd: '/work/beta', title: 'Other project', updatedAt: 200 }
  ];
  const disposable = { dispose() {} };
  const vscode = {
    EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
    TreeItem: class { constructor(label) { this.label = label; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    ProcessExecution: class { constructor(executable, args, options) { Object.assign(this, { executable, args, options }); } },
    Task: class { constructor(definition, scope, name, source, execution) { Object.assign(this, { definition, scope, name, source, execution }); } },
    TaskScope: { Workspace: 1 }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 1 }, ConfigurationTarget: { Workspace: 2, Global: 1 },
    workspace: {
      get workspaceFolders() { return current.folders.map(cwd => ({ uri: { scheme: 'file', fsPath: cwd } })); },
      getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback, update: async (key, value, target) => { config[key] = value; current.target = target; current.onConfig({ affectsConfiguration: name => name === 'agentChatScope' }); } }),
      onDidChangeWorkspaceFolders: fn => { current.onFolders = fn; return disposable; },
      onDidChangeConfiguration: fn => { current.onConfig = fn; return disposable; }
    },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return disposable; } },
    window: {
      createTreeView: (name, options) => { current.view = { ...disposable, ...options }; return current.view; },
      showQuickPick: async () => current.pick,
      showInputBox: async () => current.input,
      showErrorMessage: async message => { current.error = message; }
    },
    env: { clipboard: { writeText: async text => { current.clipboard = text; } } },
    tasks: { executeTask: async task => { tasks.push(task); } }
  };
  const filename = path.join(__dirname, '../src/extension.cjs');
  const wrapper = vm.runInThisContext(require('node:module').wrap(fs.readFileSync(filename, 'utf8')), { filename });
  const extensionModule = { exports: {} };
  wrapper(extensionModule.exports, name => {
    if (name === 'vscode') return vscode;
    if (name === './providers.cjs') return { createProviders: () => [], listProviders: async () => ({ sessions, errors: [] }) };
    if (name === 'node:fs/promises') return { stat: async () => ({ isDirectory: () => true }) };
    return require(name === './scope.cjs' ? '../src/scope.cjs' : name);
  }, extensionModule, filename, path.dirname(filename));
  const context = { subscriptions: [] };
  extensionModule.exports.activate(context);
  await new Promise(resolve => setImmediate(resolve));
  return { commands, tasks, current, sessions, config, context };
}

test('extension defaults to current project and tags each session with its provider', async () => {
  const { current } = await harness();
  const rows = current.view.treeDataProvider.getChildren();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cwd, '/work/alpha');
  assert.match(current.view.description, /Current workspace · 1/);
  assert.equal(current.view.treeDataProvider.getTreeItem(rows[0]).description, 'Codex');
});
test('scope picker switches to all projects and persists the chosen scope', async () => {
  const { current, commands, config } = await harness();
  current.pick = { scope: 'all' };
  await commands.get('agentChatScope.changeScope')();
  assert.equal(config.scope, 'all');
  assert.equal(current.view.treeDataProvider.getChildren().length, 2);
  assert.equal(current.target, 2);
});
test('folderless scope picker uses global settings and never leaks all chats by default', async () => {
  const { current, commands } = await harness({ folders: [] });
  assert.equal(current.view.treeDataProvider.getChildren().length, 0);
  assert.match(current.view.message, /Open a project folder/);
  current.pick = { scope: 'all' };
  await commands.get('agentChatScope.changeScope')();
  assert.equal(current.target, 1);
  assert.equal(current.view.treeDataProvider.getChildren().length, 2);
});
test('search can be set, canceled without loss, and cleared', async () => {
  const { current, commands } = await harness();
  current.input = 'missing';
  await commands.get('agentChatScope.search')();
  assert.equal(current.view.treeDataProvider.getChildren().length, 0);
  current.input = undefined;
  await commands.get('agentChatScope.search')();
  assert.equal(current.view.treeDataProvider.getChildren().length, 0);
  current.input = '';
  await commands.get('agentChatScope.search')();
  assert.equal(current.view.treeDataProvider.getChildren().length, 1);
});
test('workspace changes immediately recompute visible history', async () => {
  const { current } = await harness();
  current.folders = ['/work/beta'];
  current.onFolders();
  assert.equal(current.view.treeDataProvider.getChildren()[0].provider, 'claude');
});
test('clicking a conversation resumes its provider with args and original cwd', async () => {
  const { commands, sessions, tasks } = await harness();
  await commands.get('agentChatScope.resume')(sessions[0]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].execution.executable, 'codex');
  assert.deepEqual(tasks[0].execution.args, ['resume', id]);
  assert.equal(tasks[0].execution.options.cwd, '/work/alpha');
  await commands.get('agentChatScope.resume')(sessions[1]);
  assert.equal(tasks[1].execution.executable, 'claude');
  assert.deepEqual(tasks[1].execution.args, ['--resume', id]);
});
test('unknown session commands cannot launch an executable', async () => {
  const { commands, tasks } = await harness();
  await commands.get('agentChatScope.resume')({ key: 'untrusted', id, provider: 'codex', cwd: '/tmp' });
  assert.equal(tasks.length, 0);
});
test('copy command produces a provider-specific resume command', async () => {
  const { commands, sessions, current } = await harness();
  await commands.get('agentChatScope.copyResume')(sessions[1]);
  assert.equal(current.clipboard, `claude --resume ${id}`);
});
