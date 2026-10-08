'use strict';
const assert=require('node:assert/strict');const {rebuildEnvironment}=require('./rebuild-node-native');
const inherited={npm_config_runtime:'electron',npm_config_target:'28.3.3',npm_config_disturl:'https://electronjs.org/headers',npm_config_nodedir:'electron-headers',npm_package_config_node_gyp_nodedir:'electron-headers',ELECTRON_RUN_AS_NODE:'1',PATH:'preserved'};
const stable=rebuildEnvironment({environment:inherited,version:'24.21.0',platform:'win32'});
assert.equal(stable.npm_config_nodedir,undefined);assert.equal(stable.npm_package_config_node_gyp_nodedir,undefined);
assert.equal(stable.npm_config_runtime,'node');assert.equal(stable.npm_config_target,'24.15.0');assert.equal(stable.npm_config_build_from_source,'true');assert.equal(stable.npm_config_disturl,'https://nodejs.org/download/release');assert.equal(stable.PATH,'preserved');assert.equal(stable.ELECTRON_RUN_AS_NODE,undefined);
const normal=rebuildEnvironment({environment:inherited,version:'22.22.0',platform:'win32'});assert.equal(normal.npm_config_target,undefined);assert.equal(normal.npm_config_runtime,'node');
assert.equal(inherited.npm_config_runtime,'electron','caller environment must not be mutated');
console.log('Node rebuild isolates Electron config and selects compatible Windows Node 24 headers');
