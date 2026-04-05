const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.log.level,
  ...(config.isProd ? {} : {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' }
    }
  }),
});

module.exports = logger;
