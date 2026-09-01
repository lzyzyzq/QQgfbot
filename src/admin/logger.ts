import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  time: string;
  level: LogLevel;
  message: string;
}

export class Logger {
  private logPath: string;
  private maxLines = 2000;

  constructor(logPath: string) {
    this.logPath = logPath;
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log(level: LogLevel, message: string): void {
    const time = new Date().toISOString();
    const line = `[${time}] [${level.toUpperCase()}] ${message}\n`;
    fs.appendFileSync(this.logPath, line);
  }

  info(message: string): void { this.log('info', message); }
  warn(message: string): void { this.log('warn', message); }
  error(message: string): void { this.log('error', message); }
  debug(message: string): void { this.log('debug', message); }

  readLogs(lines: number = 200): LogEntry[] {
    if (!fs.existsSync(this.logPath)) return [];

    const content = fs.readFileSync(this.logPath, 'utf-8');
    const logLines = content.trim().split('\n').slice(-lines);

    return logLines.map((line) => {
      const match = line.match(/^\[(.+?)\] \[(\w+)\] (.*)$/);
      if (match) {
        return { time: match[1], level: match[2].toLowerCase() as LogLevel, message: match[3] };
      }
      return { time: '', level: 'info' as LogLevel, message: line };
    });
  }

  getLogPath(): string {
    return this.logPath;
  }
}
