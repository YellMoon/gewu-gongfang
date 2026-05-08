const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const outDir = path.join(__dirname, '..', 'src', 'generated');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'version.ts'),
  `// Auto-generated - do not edit\n// Updated: ${new Date().toISOString()}\nexport const APP_VERSION = "${pkg.version}";\n`
);
console.log(`Generated version.ts: ${pkg.version}`);
