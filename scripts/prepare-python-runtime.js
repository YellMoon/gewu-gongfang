const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PYTHON_VERSION = process.env.GEWU_PYTHON_VERSION || '3.11.9';
const PYTHON_TAG = PYTHON_VERSION.replace(/\./g, '');
const RUNTIME_DIR = path.resolve(__dirname, '..', 'runtime', 'python');
const PYTHON_EXE = path.join(RUNTIME_DIR, 'python.exe');
const PTH_FILE = path.join(RUNTIME_DIR, `python${PYTHON_TAG.slice(0, 3)}._pth`);

function run(file, args, options = {}) {
  execFileSync(file, args, { stdio: 'inherit', ...options });
}

function ensureRuntime() {
  if (fs.existsSync(PYTHON_EXE)) return;
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const zipName = `python-${PYTHON_VERSION}-embed-amd64.zip`;
  const zipPath = path.join(os.tmpdir(), zipName);
  const url = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${zipName}`;
  console.log(`[python-runtime] download ${url}`);
  run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath.replace(/'/g, "''")}'; Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${RUNTIME_DIR.replace(/'/g, "''")}' -Force`,
  ]);
}

function enableSitePackages() {
  if (!fs.existsSync(PTH_FILE)) return;
  const lines = fs.readFileSync(PTH_FILE, 'utf8').split(/\r?\n/);
  const next = lines.map(line => (line.trim() === '#import site' ? 'import site' : line));
  if (!next.some(line => line.trim() === 'Lib\\site-packages')) next.splice(Math.max(0, next.length - 1), 0, 'Lib\\site-packages');
  fs.writeFileSync(PTH_FILE, next.join('\r\n'), 'utf8');
}

function ensurePip() {
  const getPip = path.join(os.tmpdir(), 'get-pip.py');
  if (!fs.existsSync(getPip)) {
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '${getPip.replace(/'/g, "''")}'`,
    ]);
  }
  run(PYTHON_EXE, [getPip, '--no-warn-script-location']);
}

function ensurePackages() {
  run(PYTHON_EXE, ['-m', 'pip', 'install', '--upgrade', '--no-warn-script-location', 'pip']);
  run(PYTHON_EXE, ['-m', 'pip', 'install', '--upgrade', '--no-warn-script-location', 'python-docx']);
  run(PYTHON_EXE, ['-c', 'from docx import Document; print("python-docx ok")']);
}

ensureRuntime();
enableSitePackages();
ensurePip();
ensurePackages();
console.log(`[python-runtime] ready: ${PYTHON_EXE}`);
