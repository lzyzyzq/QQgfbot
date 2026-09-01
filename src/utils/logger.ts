import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const logDir = path.resolve(process.cwd(), 'data', 'logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const fileTransport = new DailyRotateFile({
  filename: path.join(logDir, 'bot-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '7d',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, module, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] [${module || 'system'}]: ${message}`;
    })
  ),
});

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, module, message }) => {
      return `[${timestamp}] [${level}] [${module || 'system'}]: ${message}`;
    })
  ),
});

const logger = winston.createLogger({
  level: 'info',
  transports: [fileTransport, consoleTransport],
});

export function createLogger(module: string) {
  return {
    info: (message: string) => logger.info({ module, message }),
    warn: (message: string) => logger.warn({ module, message }),
    error: (message: string) => logger.error({ module, message }),
    debug: (message: string) => logger.debug({ module, message }),
  };
}

export default logger;
