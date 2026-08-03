'use strict';

const crypto = require('crypto');
const path = require('path');

const RULE_PREFIX = 'GewuGongfang Primary Host LAN';
const RULE_DESCRIPTION = 'GewuGongfang managed primary host LAN rule v1';
const DEFAULT_HOST_PORT = 60462;

function firewallError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizePort(value) {
  const port = Number(value || DEFAULT_HOST_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw firewallError('WINDOWS_FIREWALL_PORT_INVALID');
  return port;
}

function normalizedPath(value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();
}

function isStableInstalledExecutable({ executablePath, isPackaged } = {}) {
  if (isPackaged !== true || !String(executablePath || '').trim()) return false;
  const candidate = normalizedPath(executablePath);
  if (!candidate.endsWith('.exe')) return false;
  return ![
    '/temp/',
    '/tmp/',
    '/win-unpacked/',
    '/node_modules/.cache/',
  ].some(fragment => candidate.includes(fragment));
}

function ruleNameFor({ executablePath, port }) {
  const digest = crypto.createHash('sha256')
    .update(`${normalizedPath(executablePath)}:${normalizePort(port)}`)
    .digest('hex')
    .slice(0, 16);
  return `${RULE_PREFIX} ${digest}`;
}

function buildWindowsHostFirewallPlan(input = {}) {
  if (input.platform !== 'win32') {
    return Object.freeze({ allowed: false, elevationAllowed: false, reason: 'WINDOWS_FIREWALL_PLATFORM_UNSUPPORTED' });
  }
  if (input.nodeRole !== 'primary-host') {
    return Object.freeze({ allowed: false, elevationAllowed: false, reason: 'WINDOWS_FIREWALL_PRIMARY_HOST_REQUIRED' });
  }
  if (!isStableInstalledExecutable(input)) {
    return Object.freeze({ allowed: false, elevationAllowed: false, reason: 'WINDOWS_FIREWALL_STABLE_INSTALL_REQUIRED' });
  }
  const port = normalizePort(input.port);
  const rule = Object.freeze({
    name: ruleNameFor({ executablePath: input.executablePath, port }),
    description: RULE_DESCRIPTION,
    direction: 'in',
    action: 'allow',
    program: path.resolve(input.executablePath),
    protocol: 'TCP',
    localPort: port,
    remoteAddress: 'LocalSubnet',
    profile: 'private',
  });
  return Object.freeze({ allowed: true, elevationAllowed: true, requiresExplicitAction: true, rule });
}

function powerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPowerShellFileArguments({ mode, helperPath, rule }) {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.resolve(helperPath),
    '-Mode', mode,
    '-RuleName', rule.name,
    '-RuleDescription', rule.description,
    '-ProgramPath', rule.program,
    '-Port', String(rule.localPort),
  ];
}

function buildFirewallAuditRequest(input = {}) {
  const plan = buildWindowsHostFirewallPlan(input);
  if (!plan.allowed) return plan;
  if (!String(input.helperPath || '').trim()) throw firewallError('WINDOWS_FIREWALL_HELPER_REQUIRED');
  return Object.freeze({
    ...plan,
    command: 'powershell.exe',
    args: buildPowerShellFileArguments({ mode: 'audit', helperPath: input.helperPath, rule: plan.rule }),
  });
}

function buildElevatedFirewallRequest(input = {}) {
  const plan = buildWindowsHostFirewallPlan(input);
  if (!plan.allowed) return plan;
  if (!['ensure', 'remove'].includes(input.action)) throw firewallError('WINDOWS_FIREWALL_ACTION_INVALID');
  if (!String(input.helperPath || '').trim()) throw firewallError('WINDOWS_FIREWALL_HELPER_REQUIRED');
  const fileArguments = buildPowerShellFileArguments({ mode: input.action, helperPath: input.helperPath, rule: plan.rule });
  const argumentList = fileArguments.map(powerShellLiteral).join(', ');
  const launcher = [
    "$result = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @(",
    argumentList,
    '); exit $result.ExitCode',
  ].join('');
  return Object.freeze({
    ...plan,
    action: input.action,
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')],
  });
}

function parseFirewallAudit(output) {
  let parsed;
  try {
    parsed = JSON.parse(String(output || '').trim());
  } catch (_error) {
    throw firewallError('WINDOWS_FIREWALL_AUDIT_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string') {
    throw firewallError('WINDOWS_FIREWALL_AUDIT_INVALID');
  }
  return Object.freeze(parsed);
}

module.exports = {
  DEFAULT_HOST_PORT,
  RULE_DESCRIPTION,
  buildWindowsHostFirewallPlan,
  buildFirewallAuditRequest,
  buildElevatedFirewallRequest,
  isStableInstalledExecutable,
  parseFirewallAudit,
};
