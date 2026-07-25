'use strict';

const automator = require('../output/miniapp-automation/node_modules/miniprogram-automator');

async function main() {
  const miniProgram = await automator.launch({
    cliPath: 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
    projectPath: 'C:/Users/83423/.openclaw/workspace/scheduling-system/miniapp',
    port: 9432,
    timeout: 60000,
    trustProject: true,
  });
  try {
    const info = await miniProgram.send('Tool.getInfo');
    const current = await miniProgram.send('App.getCurrentPage');
    console.log(JSON.stringify({
      automationPort: 9432,
      toolVersion: info.version,
      sdkVersion: info.SDKVersion,
      page: current.path,
    }));
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error && (error.stack || error.message) || String(error));
  process.exitCode = 1;
});
