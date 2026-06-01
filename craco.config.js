module.exports = {
  webpack: {
    configure: (webpackConfig) => {
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
        }
      }
      return webpackConfig;
    },
  },
};
