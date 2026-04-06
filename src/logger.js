const pino = require('pino');
const fs = require('fs');
const path = require('path');
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

// ─── File logger with daily rotation ───
const fileLogger = {
  _stream: null,
  _currentDate: null,

  _ensureDir() {
    const dir = path.resolve(config.log.dir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  },

  _dateStr() {
    return new Date().toISOString().slice(0, 10);
  },

  _getStream() {
    const today = this._dateStr();
    if (this._stream && this._currentDate === today) return this._stream;

    // Close old stream
    if (this._stream) {
      try { this._stream.end(); } catch { /* ignore */ }
    }

    const dir = this._ensureDir();
    const logFile = path.join(dir, 'dataflow.log');

    // Rotate if date changed and file exists
    if (this._currentDate && this._currentDate !== today && fs.existsSync(logFile)) {
      const rotatedName = path.join(dir, `dataflow-${this._currentDate}.log`);
      try { fs.renameSync(logFile, rotatedName); } catch { /* ignore */ }
      this._cleanOldFiles(dir);
    }

    this._currentDate = today;
    this._stream = fs.createWriteStream(logFile, { flags: 'a' });
    return this._stream;
  },

  _cleanOldFiles(dir) {
    try {
      const files = fs.readdirSync(dir)
        .filter(f => /^dataflow-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .sort()
        .reverse();
      const toDelete = files.slice(config.log.maxFiles);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(dir, f));
      }
    } catch { /* ignore */ }
  },

  log(level, message, meta) {
    if (config.isTest) return;
    const entry = JSON.stringify({
      time: new Date().toISOString(),
      level,
      msg: message,
      ...meta,
    });
    try {
      const stream = this._getStream();
      stream.write(entry + '\n');
    } catch { /* ignore */ }
  },
};

// Attach file logger methods to pino logger
logger.fileLog = fileLogger.log.bind(fileLogger);
logger._fileLogger = fileLogger;

module.exports = logger;
