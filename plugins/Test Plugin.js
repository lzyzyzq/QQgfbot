
module.exports = {
  manifest: {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: 'tester'
  },
  onLoad: function(ctx) {
    ctx.logger.info('Plugin loaded');
  },
  onEnable: function(ctx) {
    ctx.logger.info('Plugin enabled');
  },
  onDisable: function(ctx) {
    ctx.logger.info('Plugin disabled');
  },
  onUnload: function(ctx) {
    ctx.logger.info('Plugin unloaded');
  }
};
