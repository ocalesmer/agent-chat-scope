'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function check(directory) {
  for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, file.name);
    if (file.isDirectory()) check(target);
    else if (file.name.endsWith('.cjs')) {
      const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
    }
  }
}
for (const directory of ['src', 'scripts', 'test']) check(path.join(__dirname, '..', directory));
if (!process.exitCode) console.log('All JavaScript syntax checks passed.');
