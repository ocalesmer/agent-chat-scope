# Contributing

Use Node.js 20 or later. Run `npm ci`, `npm test`, and `npm run check`. Press F5 in VS Code to test the sidebar in an Extension Development Host.

Keep a change focused on a user-visible problem. Add tests for provider format changes, project-boundary behavior, or resume routing. Use synthetic fixture records created inside temporary test directories; do not commit real histories, screenshots containing private titles, credentials, or local absolute user paths.

To add a provider:

1. Implement a read-only `list()` adapter returning stable provider-qualified keys, validated session IDs, absolute working directories, titles, and timestamps.
2. Register the provider in `createProviders` and the extension's provider setting.
3. Add resume routing with argument arrays and the original working directory. Do not execute text from a transcript.
4. Add fixtures for valid, missing, malformed, and foreign-project records. Document format limitations and the validation actually performed.

Before reporting a bug, check the configured data directory and press Refresh. Include the OS, VS Code and provider versions, expected scope, and a redacted synthetic record reproducing the issue. A minimal example is enough; do not upload conversation archives.
