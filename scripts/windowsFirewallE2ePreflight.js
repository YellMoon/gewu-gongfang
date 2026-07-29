'use strict';

const childProcess = require('child_process');
const path = require('path');
const {
  buildFirewallAuditRequest,
  isStableInstalledExecutable,
  parseFirewallAudit,
} = require('../public/windowsHostFirewall');

function preflightError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isLoopbackHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch (_error) {
    return false;
  }
}

function buildLanE2ePreflight({
  platform = process.platform,
  hostExe,
  hostPort,
  helperPath,
  clientBackendUrl,
} = {}) {
  if (!isLoopbackHttpUrl(clientBackendUrl)) throw preflightError('LAN_E2E_CLIENT_LOOPBACK_REQUIRED');
  if (!isStableInstalledExecutable({ executablePath: hostExe, isPackaged: true })) {
    throw preflightError('LAN_E2E_STABLE_HOST_EXE_REQUIRED');
  }
  const request = buildFirewallAuditRequest({
    platform,
    isPackaged: true,
    nodeRole: 'primary-host',
    executablePath: path.resolve(hostExe),
    port: Number(hostPort),
    helperPath,
  });
  if (!request.allowed) throw preflightError(request.reason || 'LAN_E2E_FIREWALL_AUDIT_UNAVAILABLE');
  return Object.freeze({ required: true, clientBackendLoopback: true, request });
}

function runLanE2ePreflight({ execFileSync = childProcess.execFileSync, ...input } = {}) {
  const plan = buildLanE2ePreflight(input);
  let stdout;
  try {
    stdout = execFileSync(plan.request.command, plan.request.args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw preflightError(`LAN_E2E_FIREWALL_AUDIT_FAILED:${error.code || error.message}`);
  }
  const audit = parseFirewallAudit(stdout);
  if (audit.managed !== true || audit.state !== 'enabled' || Number(audit.localPort) !== Number(input.hostPort)) {
    throw preflightError('LAN_E2E_FIREWALL_RULE_REQUIRED');
  }
  return Object.freeze(audit);
}

module.exports = { buildLanE2ePreflight, runLanE2ePreflight, isLoopbackHttpUrl };
