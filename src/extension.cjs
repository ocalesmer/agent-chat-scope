'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const { createProviders, listProviders } = require('./providers.cjs');
const { filterSessions, resumeSpec } = require('./scope.cjs');

function activate(context) {
  const changed = new vscode.EventEmitter();
  let query = '';
  let providers = [];
  let sessions = [];
  let errors = [];
  let generation = 0;
  let disposed = false;
  const config = () => vscode.workspace.getConfiguration('agentChatScope');
  const roots = () => (vscode.workspace.workspaceFolders || []).filter(folder => ['file', 'vscode-remote'].includes(folder.uri.scheme)).map(folder => folder.uri.fsPath);
  const filtered = () => filterSessions(sessions, { roots: roots(), scope: config().get('scope', 'workspace'), includeSubfolders: config().get('includeSubfolders', true), query });
  const tree = {
    onDidChangeTreeData: changed.event,
    getChildren: () => filtered(),
    getTreeItem: session => {
      const item = new vscode.TreeItem(session.title);
      item.id = session.key;
      item.description = session.provider === 'codex' ? 'Codex' : 'Claude Code';
      item.tooltip = `${item.description}\n${session.cwd}\n${new Date(session.updatedAt).toLocaleString()}`;
      item.iconPath = new vscode.ThemeIcon('comment-discussion');
      item.contextValue = 'agentChatScope.session';
      item.command = { command: 'agentChatScope.open', title: 'Open Conversation', arguments: [session] };
      return item;
    }
  };
  const view = vscode.window.createTreeView('agentChatScope.chats', { treeDataProvider: tree, showCollapseAll: false });
  function render() {
    if (disposed) return;
    const scope = config().get('scope', 'workspace');
    const count = filtered().length;
    view.description = `${scope === 'all' ? 'All projects' : 'Current workspace'} · ${count}`;
    const messages = [];
    if (scope !== 'all' && !roots().length) messages.push('Open a project folder, or choose All projects from the filter menu.');
    else if (!count) messages.push(query ? 'No matching conversations. Clear the title search to see other chats.' : 'No local conversations found for this scope. Use Refresh after starting a conversation.');
    if (query) messages.push(`Search: ${query}`);
    if (errors.length) messages.push(errors.map(error => `${error.provider}: could not read history (${error.code}). Check the provider data directory in Settings.`).join(' '));
    view.message = messages.join('\n') || undefined;
    changed.fire();
  }
  async function refresh() {
    const current = ++generation;
    view.message = 'Reading local conversation metadata…';
    const enabled = config().get('providers', ['codex', 'claude']);
    const result = await listProviders(providers.filter(provider => enabled.includes(provider.id)));
    if (disposed || current !== generation) return;
    sessions = result.sessions;
    errors = result.errors;
    render();
  }
  function resetProviders() {
    providers = createProviders({ codexHome: config().get('codexHome'), claudeHome: config().get('claudeHome') });
    return refresh();
  }
  async function open(session) {
    const selected = sessions.find(item => item.key === session?.key);
    if (!selected) return;
    if (selected.provider !== 'codex') return resume(selected);
    try {
      const extension = vscode.extensions.getExtension('openai.chatgpt');
      if (!extension) throw new Error('Install and enable the OpenAI Codex extension to open this conversation in the Codex sidebar.');
      if (!extension.isActive) await extension.activate();
      // Codex's URI handler focuses its sidebar and queues /local/:id navigation
      // until the webview is ready. Opening the sidebar command alone loses the ID.
      const uri = vscode.Uri.from({ scheme: vscode.env.uriScheme, authority: 'openai.chatgpt', path: `/local/${selected.id}` });
      if (!await vscode.env.openExternal(uri)) throw new Error('VS Code could not open the Codex conversation link.');
    } catch (error) {
      const action = await vscode.window.showErrorMessage(`Could not open this conversation in Codex: ${error.message}`, 'Resume in Terminal');
      if (action === 'Resume in Terminal') await resume(selected);
    }
  }
  async function resume(session) {
    // Only entries actually supplied by a local provider may be resumed.
    const selected = sessions.find(item => item.key === session?.key);
    if (!selected) return;
    try {
      const spec = resumeSpec(selected, { codex: config().get('codexExecutable'), claude: config().get('claudeExecutable') });
      const stat = await fs.stat(spec.cwd);
      if (!stat.isDirectory()) throw new Error('The original project folder is no longer available.');
      const execution = new vscode.ProcessExecution(spec.executable, spec.args, { cwd: spec.cwd });
      const task = new vscode.Task({ type: 'agentChatScope', session: selected.key }, vscode.TaskScope.Workspace,
        `Resume ${selected.provider} ${selected.id.slice(0, 8)}`, 'Agent Chat Scope', execution);
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, focus: true };
      await vscode.tasks.executeTask(task);
    } catch (error) {
      await vscode.window.showErrorMessage(`Could not resume this conversation: ${error.message} Check the provider executable in Agent Chat Scope settings.`);
    }
  }
  context.subscriptions.push(changed, view,
    { dispose() { disposed = true; generation++; } },
    vscode.commands.registerCommand('agentChatScope.refresh', refresh),
    vscode.commands.registerCommand('agentChatScope.open', open),
    vscode.commands.registerCommand('agentChatScope.resume', resume),
    vscode.commands.registerCommand('agentChatScope.copyResume', async session => {
      const selected = sessions.find(item => item.key === session?.key);
      if (!selected) return;
      const spec = resumeSpec(selected);
      await vscode.env.clipboard.writeText([selected.provider, ...spec.args].join(' '));
    }),
    vscode.commands.registerCommand('agentChatScope.changeScope', async () => {
      const selected = await vscode.window.showQuickPick([
        { label: 'Current workspace', description: 'Only chats belonging to open project folders', scope: 'workspace' },
        { label: 'All projects', description: 'All local Codex and Claude Code chats', scope: 'all' }
      ], { title: 'Conversation scope', placeHolder: 'Choose which projects to show' });
      if (selected) await config().update('scope', selected.scope, roots().length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('agentChatScope.search', async () => {
      const value = await vscode.window.showInputBox({ title: 'Search conversation titles', prompt: 'Search title, provider, or project path. Leave empty to clear.', value: query });
      if (value !== undefined) { query = value; render(); }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(render),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('agentChatScope.codexHome') || event.affectsConfiguration('agentChatScope.claudeHome') || event.affectsConfiguration('agentChatScope.providers')) void resetProviders();
      else if (event.affectsConfiguration('agentChatScope')) render();
    })
  );
  void resetProviders();
}

module.exports = { activate };
