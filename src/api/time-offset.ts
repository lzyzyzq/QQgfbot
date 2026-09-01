import { Router } from 'express';
import { getConfig, setConfig } from '../db/index';

const router = Router();

router.get('/time-offset', (_req, res) => {
  const offset = parseInt(getConfig('system.time_offset') || '0', 10);
  res.json({ offset, label: formatOffsetLabel(offset) });
});

router.put('/time-offset', (req, res) => {
  const { offset } = req.body;
  if (typeof offset !== 'number' || isNaN(offset)) {
    res.status(400).json({ error: 'offset must be a number (minutes)' });
    return;
  }
  const clamped = Math.max(-1440, Math.min(1440, Math.round(offset)));
  setConfig('system.time_offset', String(clamped));
  res.json({ offset: clamped, label: formatOffsetLabel(clamped) });
});

function formatOffsetLabel(minutes: number): string {
  if (minutes === 0) return '未设置(使用服务器时间)';
  const sign = minutes > 0 ? '+' : '';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return sign + minutes + '分钟' + (h > 0 ? ' (' + sign + h + '小时' + (m > 0 ? m + '分' : '') + ')' : '');
}

export { formatOffsetLabel };
export default router;
