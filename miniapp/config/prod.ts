export default {
  env: {
    NODE_ENV: '"production"',
    APP_ENV: JSON.stringify(process.env.MINIAPP_APP_ENV || 'prod'),
    API_BASE_URL: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'https://api.gewugongfang.com/api')
  },
  defineConstants: {
    __APP_ENV__: JSON.stringify(process.env.MINIAPP_APP_ENV || 'prod'),
    __API_BASE_URL__: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'https://api.gewugongfang.com/api')
  },
  mini: {},
  h5: {
    publicPath: '/'
  }
};
