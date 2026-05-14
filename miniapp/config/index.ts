import { defineConfig } from '@tarojs/cli';

const appEnv = process.env.MINIAPP_APP_ENV || process.env.APP_ENV || 'dev';
const apiBaseUrl = process.env.MINIAPP_API_BASE_URL || 'http://localhost:3001/api';

const config = defineConfig({
  projectName: 'scheduling-miniapp',
  date: '2026-5-4',
  designWidth: 375,
  deviceRatio: {
    375: 2 / 1,
    640: 1.17 / 2,
    750: 1,
    828: 0.905 / 1.81
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [
    '@tarojs/plugin-framework-react'
  ],
  defineConstants: {
    __APP_ENV__: JSON.stringify(appEnv),
    __API_BASE_URL__: JSON.stringify(apiBaseUrl)
  },
  copy: {
    patterns: [],
    options: {}
  },
  framework: 'react',
  compiler: 'webpack5',
  cache: { enable: false },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      url: {
        enable: true,
        config: {
          limit: 1024
        }
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    },
    // 小程序不生成 sourcemap（减小体积）
    enableSourceMap: false
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    esnextModules: ['taro-ui'],
    postcss: {
      autoprefixer: {
        enable: true,
        config: {}
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  }
});

export default config;
