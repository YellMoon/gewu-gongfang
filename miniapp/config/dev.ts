export default {
  env: {
    NODE_ENV: '"development"',
    APP_ENV: '"dev"',
    API_BASE_URL: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'http://localhost:3001/api'),
    CLOUD_BUSINESS_API_BASE_URL: JSON.stringify(process.env.MINIAPP_CLOUD_BUSINESS_API_BASE_URL || 'http://localhost:3002')
  },
  defineConstants: {
    __APP_ENV__: JSON.stringify(process.env.MINIAPP_APP_ENV || 'dev'),
    __API_BASE_URL__: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'http://localhost:3001/api'),
    __CLOUD_BUSINESS_API_BASE_URL__: JSON.stringify(process.env.MINIAPP_CLOUD_BUSINESS_API_BASE_URL || 'http://localhost:3002'),
    __APP_VERSION__: JSON.stringify(process.env.MINIAPP_APP_VERSION || require('../package.json').version)
  },
  mini: {},
  h5: {}
};
