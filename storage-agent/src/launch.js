'use strict';

const path = require('path');
const { loadEnvironmentFile } = require('./launchConfig');

const configPath = process.argv[2] || path.join(process.env.ProgramData || 'C:/ProgramData', 'GewuStorageAgent', 'agent.env');
Object.assign(process.env, loadEnvironmentFile(path.resolve(configPath)));
require('./main');
