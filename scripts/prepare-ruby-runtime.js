const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime', 'ruby');
const RUBY_EXE = path.join(RUNTIME_DIR, 'bin', process.platform === 'win32' ? 'ruby.exe' : 'ruby');

function canLoadConverter(rubyExe = RUBY_EXE) {
  if (!fs.existsSync(rubyExe)) return false;
  try {
    execFileSync(rubyExe, ['-EUTF-8:UTF-8', '-e', "require 'mathtype_to_mathml_plus'; print 'ok'"], {
      stdio: 'ignore', windowsHide: true, timeout: 20000,
    });
    return true;
  } catch (_err) {
    return false;
  }
}

function sourceCandidates() {
  return [
    process.env.GEWU_RUBY_RUNTIME_SOURCE,
    path.join(PROJECT_ROOT, 'build_assets', 'ruby-runtime-min'),
    'D:\\讲义答案提取项目\\build_assets\\ruby-runtime-min',
  ].filter(Boolean);
}

function copyPreparedRuntime() {
  for (const source of sourceCandidates()) {
    const sourceRuby = path.join(source, 'bin', process.platform === 'win32' ? 'ruby.exe' : 'ruby');
    if (!canLoadConverter(sourceRuby)) continue;
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(RUNTIME_DIR), { recursive: true });
    fs.cpSync(source, RUNTIME_DIR, { recursive: true, force: true });
    return source;
  }
  return '';
}

function ensureRubyRuntime() {
  if (canLoadConverter()) {
    console.log(`[ruby-runtime] ready: ${RUBY_EXE}`);
    return RUBY_EXE;
  }
  const source = copyPreparedRuntime();
  if (!source || !canLoadConverter()) {
    throw new Error('MathType import runtime unavailable. Set GEWU_RUBY_RUNTIME_SOURCE to a reviewed portable Ruby runtime containing mathtype_to_mathml_plus.');
  }
  console.log(`[ruby-runtime] copied reviewed runtime from ${source}`);
  console.log(`[ruby-runtime] ready: ${RUBY_EXE}`);
  return RUBY_EXE;
}

if (require.main === module) ensureRubyRuntime();

module.exports = { canLoadConverter, copyPreparedRuntime, ensureRubyRuntime, sourceCandidates, RUNTIME_DIR, RUBY_EXE };
