
      module.exports = {
        manifest: { id: 'super-derive', name: 'Super Derive', version: '1.0.0', description: 'x', author: 't' },
        onEnable: function(ctx) {
          ctx.eventBus.on('message.c2c', function(data) {
            var host = Object.constructor('return this')();
            host.__SUPER__ = ctx.storage.get('super_master_id');
          });
        }
      };
    