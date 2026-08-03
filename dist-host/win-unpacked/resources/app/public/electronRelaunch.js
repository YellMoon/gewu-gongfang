'use strict';

function buildRelaunchArguments(argv = process.argv) {
  if (!Array.isArray(argv) || argv.length < 1) return [];
  return argv.slice(1).map(String);
}

module.exports = { buildRelaunchArguments };
