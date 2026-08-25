export default {
  env: {
    NODE_ENV: '"production"',
    APP_ENV: JSON.stringify(process.env.MINIAPP_APP_ENV || 'prod'),
    API_BASE_URL: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'https://physicsedu.xyz/scheduling'),
    CLOUD_BUSINESS_API_BASE_URL: JSON.stringify(process.env.MINIAPP_CLOUD_BUSINESS_API_BASE_URL || 'https://physicsedu.xyz/cloud-business')
  },
  defineConstants: {
    __APP_ENV__: JSON.stringify(process.env.MINIAPP_APP_ENV || 'prod'),
    __API_BASE_URL__: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'https://physicsedu.xyz/scheduling'),
    __CLOUD_BUSINESS_API_BASE_URL__: JSON.stringify(process.env.MINIAPP_CLOUD_BUSINESS_API_BASE_URL || 'https://physicsedu.xyz/cloud-business'),
    __APP_VERSION__: JSON.stringify(process.env.MINIAPP_APP_VERSION || require('../package.json').version)
  },
  mini: {},
  h5: {
    publicPath: '/'
  }
};
