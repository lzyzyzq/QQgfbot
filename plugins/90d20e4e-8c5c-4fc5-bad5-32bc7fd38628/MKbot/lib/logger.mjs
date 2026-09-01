import fs from 'fs';
import path from 'path';

let logPath = '';

export function setLogPath(dataPath) {
  logPath = path.join(dataPath, 'logs');
  if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true });
  }
}

export function writeLog(type, data) {
  if (!logPath) return;
  
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toISOString().split('T')[1]; // HH:mm:ss.sssZ
    
    const logFile = path.join(logPath, `${dateStr}.log`);
    
    // 格式化日志内容
    let logContent = `[${timeStr}] [${type}] `;
    
    if (typeof data === 'string') {
      logContent += data;
    } else {
      logContent += JSON.stringify(data);
    }
    
    logContent += '\n';
    
    // 追加到日志文件
    fs.appendFileSync(logFile, logContent, 'utf-8');
  } catch (error) {
    console.error('[Logger] 写入日志失败:', error);
  }
}

export function logEvent(eventType, event) {
  writeLog('EVENT', JSON.stringify({
    type: eventType,
    post_type: event.post_type,
    notice_type: event.notice_type,
    message_type: event.message_type,
    user_id: event.user_id,
    group_id: event.group_id,
    raw_message: event.raw_message,
    timestamp: new Date().toISOString()
  }));
}

export function logMessage(message) {
  writeLog('MESSAGE', message);
}

export function logError(error) {
  writeLog('ERROR', error instanceof Error ? error.message : String(error));
}
