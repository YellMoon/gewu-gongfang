export default {
  env: {
    NODE_ENV: '"development"',
    APP_ENV: '"dev"',
    API_BASE_URL: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'http://localhost:3001/api')
  },
  defineConstants: {
    __APP_ENV__: JSON.stringify(process.env.MINIAPP_APP_ENV || 'dev'),
    __API_BASE_URL__: JSON.stringify(process.env.MINIAPP_API_BASE_URL || 'http://localhost:3001/api')
  },
  mini: {},
  h5: {}
};
