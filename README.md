# Agent Chat Scope

**Your project. Your agents. The right conversations.**

An open-source VS Code extension that brings local **Codex** and **Claude Code** history into one project-scoped sidebar. Open a project and see its conversations. Switch to **All projects** when you want to browse across your machine.

Early preview · MIT license · No runtime dependencies · No telemetry

## What it does

- Shows Codex and Claude Code conversations in the **Agent Chats** Activity Bar view.
- Defaults to the current workspace, including multiple open folders and their subfolders.
- Uses the recorded working directory to determine project membership. Similar folder names do not match accidentally.
- Provides an explicit **Current workspace / All projects** filter and a title search.
- Resumes a selected conversation in its original directory using the provider's CLI.
- Reads existing local metadata without editing, moving, archiving, or deleting conversation files.

This is a separate sidebar. Codex's and Claude Code's built-in history panels keep their existing behavior. No vendor extension is modified. Cloud-only conversations, desktop-app-only histories, and history on another machine are outside this preview's scope.

## Install

Download the `.vsix` from [Releases](https://github.com/ocalesmer/agent-chat-scope/releases), then run **Extensions: Install from VSIX…** in VS Code. Reload the window if prompted and open **Agent Chats** in the Activity Bar.

To build a VSIX from source, use Node.js 20 or later:

```sh
git clone https://github.com/ocalesmer/agent-chat-scope.git
cd agent-chat-scope
npm ci
npm test
npm run check
npm run package
```

The package is written to `dist/agent-chat-scope-0.1.0.vsix`. For development, open this folder in VS Code and press **F5** to launch the Extension Development Host. The extension itself needs no npm packages at runtime.

## Use

1. Open a project folder or a multi-root workspace.
2. Open **Agent Chats**. Only conversations recorded in those project folders appear by default.
3. Use the funnel icon to choose **All projects**, the search icon to search titles, or **Refresh** after a conversation starts or changes.
4. Click a conversation to resume it in a dedicated integrated terminal. Install the matching CLI (`codex` or `claude`) first, or configure its executable path.

Clicking a conversation starts the provider CLI in its recorded directory. Browsing or refreshing the list does not start either agent. Resume follows the provider's own configuration and permission behavior.

**No folder open?** Current workspace mode shows an instruction to open a folder. All projects mode is available from the filter menu. Archived Codex conversations and subagent histories are excluded.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `agentChatScope.scope` | `workspace` | `workspace` or `all` |
| `agentChatScope.includeSubfolders` | `true` | Include conversations started below an open folder |
| `agentChatScope.providers` | `["codex", "claude"]` | Enabled local providers |
| `agentChatScope.codexHome` | empty | Uses `CODEX_HOME` or `~/.codex` |
| `agentChatScope.claudeHome` | empty | Uses `CLAUDE_CONFIG_DIR` or `~/.claude` |
| `agentChatScope.codexExecutable` | `codex` | Executable name or path for resume |
| `agentChatScope.claudeExecutable` | `claude` | Executable name or path for resume |

Windows drive-letter paths are compared without case sensitivity. POSIX paths retain case sensitivity. Project matching uses path-component boundaries. Symlink aliases and separate Git worktrees are treated as separate paths; add each desired root to your workspace. WSL, SSH, and containers read the history available to the workspace extension host. Set the data directories when histories live elsewhere; Windows and WSL path mappings are not inferred automatically.

## Privacy and compatibility

All history discovery stays on your machine. The extension sends no network requests and collects no analytics. Titles and project paths are displayed locally. Conversation files are opened read-only; their first 1 MiB is read to locate metadata, then cached by modification time and size. The Codex title index is streamed. The extension does not interpret instructions contained in conversation files.

Local history formats are internal and can change. The current adapters recognize Codex `session_meta` records and `session_index.jsonl`, plus Claude Code project JSONL records and optional `sessions-index.json` titles. Unknown records without a valid session ID and absolute working directory are omitted. Missing title metadata produces a provider-and-ID label. This preview does not promise to recover every historical session or show up-to-the-second state. Use Refresh to rescan.

Validation includes synthetic history fixtures for both providers, cross-platform path tests, and extension command tests. The initial live check used local Codex history. Claude Code was not installed on that validation machine; its adapter was tested against synthetic format fixtures. Native UI installation and successful authenticated resume should be checked in your own environment before relying on this preview.

Provider references: [OpenAI projects and chats](https://learn.chatgpt.com/docs/projects), [Claude Code session storage and resume](https://code.claude.com/docs/en/sessions). Claude documents its transcript schema as internal; format-related bug reports should include a **redacted synthetic example**, never a private transcript.

## Extend it

Providers implement `id` and asynchronous `list()`, returning `{ key, provider, id, cwd, title, updatedAt }`. Filtering lives in `src/scope.cjs`; history readers live in `src/providers.cjs`. A failed reader does not hide another provider's conversations. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Türkçe

Codex ve Claude Code sohbetlerini açık projeye göre gösteren, MIT lisanslı bir VS Code uzantısıdır. **Agent Chats** paneli varsayılan olarak yalnızca açık çalışma alanının sohbetlerini gösterir. Huni simgesinden **All projects** seçeneğine geçebilirsiniz. Sohbet seçildiğinde ilgili CLI, sohbetin asıl klasöründe açılır. Uzantı mevcut sohbetleri değiştirmez; sağlayıcıların kendi geçmiş panelleri ayrı kalır.

## License

[MIT](LICENSE). Independent community project, unaffiliated with OpenAI, Anthropic, and Microsoft.
