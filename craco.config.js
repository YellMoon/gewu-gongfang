module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      if (process.env.GEWU_E2E_SKIP_TYPECHECK === '1') {
        webpackConfig.plugins = webpackConfig.plugins.filter(plugin => (
          plugin?.constructor?.name !== 'ForkTsCheckerWebpackPlugin'
        ));
      }
      const oneOfRule = webpackConfig.module.rules.find(r => r.oneOf);
      if (oneOfRule) {
        const babelLoaderRule = oneOfRule.oneOf.find(
          r => r.loader && r.loader.includes('babel-loader')
        );
        if (babelLoaderRule) {
          const originalExclude = babelLoaderRule.exclude || [];
          babelLoaderRule.exclude = [
            ...(Array.isArray(originalExclude) ? originalExclude : [originalExclude]),
            /node_modules[\\/]docx[\\/]/,
          ];
          // src 里的 CommonJS 服务文件（module.exports）默认会被 babel 按
          // sourceType: 'module' 编译；一旦 babel 注入 @babel/runtime 的 ESM
          // helper import，webpack 就把它们当作 ES Module，运行时对
          // module.exports 赋值会抛出 "ES Modules may not assign module.exports"。
          // 与 CRA 对 node_modules 的处理一致，按文件内容自动判定模块类型。
          babelLoaderRule.options = {
            ...babelLoaderRule.options,
            overrides: [
              ...((babelLoaderRule.options && babelLoaderRule.options.overrides) || []),
              { test: /\.js$/, sourceType: 'unambiguous' },
            ],
          };
        }
      }
      return webpackConfig;
    },
  },
};
