'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const miniappRoot = path.resolve(__dirname, '../..');
const appConfig = fs.readFileSync(path.join(miniappRoot, 'src/app.config.ts'), 'utf8');
const routes = [...appConfig.matchAll(/['"](pages\/[^'"]+)['"]/g)].map(match => match[1]);
const pageSources = new Set(routes.map(route => path.normalize(path.join(miniappRoot, 'src', `${route}.tsx`))));
const pageDirectories = [...pageSources]
  .map(source => ({ source, directory: path.dirname(source) }))
  .sort((left, right) => right.directory.length - left.directory.length);
const violations = [];

for (const sourcePath of pageSources) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const resolvedBase = path.resolve(path.dirname(sourcePath), specifier);
    const candidates = [
      `${resolvedBase}.tsx`,
      `${resolvedBase}.ts`,
      `${resolvedBase}.js`,
      path.join(resolvedBase, 'index.tsx'),
      path.join(resolvedBase, 'index.ts'),
      path.join(resolvedBase, 'index.js'),
    ].map(candidate => path.normalize(candidate));
    const importedModule = candidates.find(candidate => fs.existsSync(candidate));
    if (!importedModule) continue;
    const owner = pageDirectories.find(page => importedModule === page.source
      || importedModule.startsWith(`${page.directory}${path.sep}`));
    if (owner && owner.directory !== path.dirname(sourcePath)) {
      violations.push(`${path.relative(miniappRoot, sourcePath)} -> ${path.relative(miniappRoot, importedModule)}`);
    }
  }
}

assert.deepStrictEqual(
  violations,
  [],
  `registered page modules must not import implementation files from other page directories: ${violations.join(', ')}`,
);

const questionBankSource = fs.readFileSync(
  path.join(miniappRoot, 'src/pages/question-bank/index.tsx'),
  'utf8',
);
assert.ok(
  !questionBankSource.includes("../../components/UnrecognizedExperienceContent"),
  'formal question-bank page bundle must not statically include the unsupported experience implementation',
);
assert.ok(
  !questionBankSource.includes('/pages/unsupported-experience/index'),
  'retired unsupported question-bank access must not redirect to a deleted parallel experience page',
);

console.log('miniapp page registration boundary checks passed');
