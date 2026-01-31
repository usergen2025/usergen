const path = require('path');

module.exports = function (options) {
  return {
    ...options,
    resolve: {
      ...options.resolve,
      alias: {
        ...options.resolve?.alias,
        // Alias for shared storage module
        '@shared': path.resolve(__dirname, '../../shared'),
      },
    },
  };
};

