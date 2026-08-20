const fs = require('fs');
const path = require('path');

const ACTIVE_DOCUMENTS = Object.freeze([
  'AGENTS.md',
  'docs/superpowers/specs/2026-08-13-cloud-authority-vnext-design.md',
  'docs/superpowers/specs/2026-08-21-vnext-cloud-business-authority-architecture-contract.md',
  'docs/superpowers/specs/2026-08-14-vnext-production-control-plane-database-decision.md',
  'docs/superpowers/inventories/2026-08-21-vnext-cloud-authority-delivery-readiness.md',
  'docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md',
  'docs/superpowers/specs/2026-08-20-vnext-local-business-repository-retention-and-control-plane-projection-no-export-design.md',
  'docs/superpowers/specs/2026-08-15-vnext-pg17-production-adapter-design.md',
  'docs/superpowers/specs/2026-08-21-unified-desktop-silent-registration-offline-draft-admission-design.md',
  'docs/vnext-source-data-dictionary.md',
  'docs/superpowers/plans/2026-08-13-vnext-cloud-schema-shadow-import.md',
  'task.md',
  'package.json',
]);

const REQUIRED_MARKERS = Object.freeze({
  'AGENTS.md': Object.freeze([
    '云端数据库保存适用业务数据与题库结构化文字内容，并是其唯一可写权威',
    'NAS 或受控存储代理只保存题库富媒体',
    '新设备首次登录必须联网完成账号验证，成功后静默登记设备',
  ]),
  'docs/superpowers/specs/2026-08-13-cloud-authority-vnext-design.md': Object.freeze([
    '当前唯一总体架构总纲',
    '业务数据、题库结构化内容、任务状态和审计记录的唯一权威来源',
    'NAS 或独立存储代理只负责题库大文件',
  ]),
  'docs/superpowers/specs/2026-08-21-vnext-cloud-business-authority-architecture-contract.md': Object.freeze([
    '云端业务权威架构强制契约',
    '云端是适用业务数据与题库结构化文字内容的唯一可写权威',
    '新设备首次登录必须在线验证账号，验证成功后静默登记设备',
    '旧的本地主机业务权威路线不得作为活跃实现依据',
  ]),
  'docs/superpowers/specs/2026-08-14-vnext-production-control-plane-database-decision.md': Object.freeze([
    'vNext production cloud business authority database decision',
    '云端是适用业务数据与题库结构化文字内容的唯一可写权威',
    '题库富媒体、导入原件、Word/PDF 产物和备份仍由 NAS/存储代理承载',
  ]),
  'docs/superpowers/inventories/2026-08-21-vnext-cloud-authority-delivery-readiness.md': Object.freeze([
    '云端业务权威总纲',
    '云端数据库承载适用业务数据和题库结构化文字内容的唯一可写权威',
    'NAS/存储代理承载题库富媒体',
  ]),
  'docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md': Object.freeze([
    '已降级为局部安全参考，不是总体执行基线',
  ]),
  'docs/superpowers/specs/2026-08-20-vnext-local-business-repository-retention-and-control-plane-projection-no-export-design.md': Object.freeze([
    '已由云端业务权威总纲取代',
  ]),
  'docs/superpowers/specs/2026-08-15-vnext-pg17-production-adapter-design.md': Object.freeze([
    '已降级为本地控制面验证参考',
  ]),
  'docs/superpowers/specs/2026-08-21-unified-desktop-silent-registration-offline-draft-admission-design.md': Object.freeze([
    '只保留一种桌面端安装包',
    '不需要管理员、旧设备或所谓主机人工审批',
    '离线不是重新登录通道',
    '当前不准入实现',
  ]),
  'docs/vnext-source-data-dictionary.md': Object.freeze([
    'Active vNext Full-Business Source Dictionary',
    'cloud-business-authority migration',
    'Business tables are not rejected merely because of their domain.',
    'A user-declared absence is not a structural inventory result.',
    'unexpected non-empty question/asset-labeled relations stay quarantined',
  ]),
  'docs/superpowers/plans/2026-08-13-vnext-cloud-schema-shadow-import.md': Object.freeze([
    'Rebased (2026-08-21)',
    'cloud business authority',
    'a user-declared absence is not an inventory result',
  ]),
  'task.md': Object.freeze([
    'Current architecture contract (2026-08-21, binding)',
    'cloud is the sole writable authority for applicable business data',
    'one desktop build',
    'online account verification and silently records the device',
    'Offline work is a local draft until the user confirms submission to the cloud.',
    'Historical content after this block is non-binding',
  ]),
  'package.json': Object.freeze([
    '"test:cloud-business-authority-contract": "node scripts/check_cloud_business_authority_contract.test.js"',
    'node scripts/check_cloud_business_authority_contract.test.js',
  ]),
});

const ACTIVE_DESKTOP_CONTRADICTIONS = Object.freeze({
  'docs/superpowers/specs/2026-08-21-unified-desktop-silent-registration-offline-draft-admission-design.md': Object.freeze([
    'Human device approval is required.',
    'A primary-host desktop package is required.',
    'Offline login is allowed for a new device.',
  ]),
});

const ACTIVE_CONTRADICTIONS = Object.freeze({
  'AGENTS.md': Object.freeze([
    '本地数据主机保存全量权威业务数据',
    '阿里云只承担认证、设备、心跳、中继、快照、小程序 API 和任务队列，不作为最高权威业务数据库',
  ]),
  'docs/superpowers/inventories/2026-08-21-vnext-cloud-authority-delivery-readiness.md': Object.freeze([
    '本地数据主机仍保存完整权威业务数据',
    '云端 PostgreSQL 不是业务表、题库文件、个人资产、附件、路径、NAS 或桌面 SQLite 的替代品',
    '只覆盖 control-plane 的授权判断与跨端协调',
  ]),
  'docs/superpowers/specs/2026-08-14-vnext-production-control-plane-database-decision.md': Object.freeze([
    'control-plane-only',
    'does not move business authority to the cloud',
    'Control-plane data only',
  ]),
  'docs/vnext-source-data-dictionary.md': Object.freeze([
    'It rejects every business-domain table by default.',
    'control-plane allow-list',
    'The first approved legacy desktop root is known to contain no question-bank or personal-asset source data.',
  ]),
  'docs/superpowers/plans/2026-08-13-vnext-cloud-schema-shadow-import.md': Object.freeze([
    '> **Deferred (2026-08-13):**',
    'not executable until a specific business domain has passed the active control-plane-first plan',
  ]),
  'task.md': Object.freeze([
    'The local data host remains the sole business authority.',
    'two independent packaged Electron applications',
    'Human device approval is required.',
  ]),
});

const TASK_CONTRACT_START = '<!-- current-architecture-contract:start -->';
const TASK_CONTRACT_END = '<!-- current-architecture-contract:end -->';

function activeArchitectureText(relativePath, text) {
  if (relativePath !== 'task.md') return text;
  const start = text.indexOf(TASK_CONTRACT_START);
  const end = text.indexOf(TASK_CONTRACT_END);
  if (start < 0 || end < start) return '';
  return text.slice(start, end + TASK_CONTRACT_END.length);
}

function checkContractTexts(texts) {
  const issues = [];
  for (const relativePath of ACTIVE_DOCUMENTS) {
    const text = texts[relativePath];
    if (typeof text !== 'string') {
      issues.push(`${relativePath}: missing active architecture input`);
      continue;
    }
    const architectureText = activeArchitectureText(relativePath, text);
    for (const marker of REQUIRED_MARKERS[relativePath] || []) {
      if (!architectureText.includes(marker)) issues.push(`${relativePath}: missing required cloud-business-authority marker: ${marker}`);
    }
    for (const contradiction of ACTIVE_CONTRADICTIONS[relativePath] || []) {
      if (architectureText.includes(contradiction)) issues.push(`${relativePath}: local-business-authority contradiction: ${contradiction}`);
    }
    for (const contradiction of ACTIVE_DESKTOP_CONTRADICTIONS[relativePath] || []) {
      if (architectureText.includes(contradiction)) issues.push(`${relativePath}: desktop-registration contradiction: ${contradiction}`);
    }
  }
  return Object.freeze({ issues: Object.freeze(issues) });
}

function checkCloudBusinessAuthorityContract() {
  const texts = {};
  for (const relativePath of ACTIVE_DOCUMENTS) {
    const absolutePath = path.join(process.cwd(), relativePath);
    texts[relativePath] = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null;
  }
  return checkContractTexts(texts);
}

function main() {
  const result = checkCloudBusinessAuthorityContract();
  console.log('Cloud business authority architecture contract');
  console.log(`- result: ${result.issues.length === 0 ? 'pass' : 'fail'}`);
  for (const issue of result.issues) console.log(`- ${issue}`);
  if (result.issues.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  ACTIVE_DOCUMENTS,
  ACTIVE_DESKTOP_CONTRADICTIONS,
  activeArchitectureText,
  checkCloudBusinessAuthorityContract,
  checkContractTexts,
};
