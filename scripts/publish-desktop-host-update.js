'use strict';

const path = require('path');

process.env.DIST_DIR = process.env.DIST_DIR || path.resolve(__dirname, '..', 'dist-host');
process.env.OSS_CDN_BASE_URL = process.env.OSS_CDN_BASE_URL
  || 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop-host';
process.env.OSS_OBJECT_PREFIX = process.env.OSS_OBJECT_PREFIX || 'desktop-host';
process.env.OSS_RELEASES_PREFIX = process.env.OSS_RELEASES_PREFIX || 'desktop-host/releases';

require('./publish-oss-feed');
