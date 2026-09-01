import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const router = Router();

router.get('/logs', async (req: Request, res: Response) => {
  const { level, limit = '100', offset = '0' } = req.query;

  const logDir = path.resolve(process.cwd(), 'data', 'logs');
  const logs: any[] = [];
  const numLimit = Math.min(parseInt(limit as string) || 100, 500);
  let numOffset = parseInt(offset as string) || 0;

  try {
    if (!fs.existsSync(logDir)) {
      res.json({ logs: [], total: 0 });
      return;
    }

    const files = fs.readdirSync(logDir)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();

    const allLines: string[] = [];

    for (const file of files.slice(0, 3)) {
      const filePath = path.join(logDir, file);
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      });

      const lines: string[] = [];
      for await (const line of rl) {
        lines.push(line);
      }
      allLines.push(...lines.reverse());
    }

    const filtered = allLines.filter((line) => {
      if (!level) return true;
      const levelFilter = (level as string).toUpperCase();
      return line.includes(`[${levelFilter}]`);
    });

    const sliced = filtered.slice(numOffset, numOffset + numLimit);

    for (const line of sliced) {
      const match = line.match(/^\[(.*?)\]\s*\[(\w+)\]\s*\[(.*?)\]:\s*(.*)$/);
      if (match) {
        logs.push({
          timestamp: match[1],
          level: match[2].toLowerCase(),
          module: match[3],
          message: match[4],
        });
      } else {
        logs.push({
          timestamp: '',
          level: 'info',
          module: '',
          message: line,
        });
      }
    }

    res.json({ logs, total: filtered.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/logs', async (_req: Request, res: Response) => {
  const logDir = path.resolve(process.cwd(), 'data', 'logs');
  try {
    let count = 0;
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      for (const file of files) {
        fs.unlinkSync(path.join(logDir, file));
      }
      count = files.length;
    }
    res.json({ success: true, message: `已清空 ${count} 个日志文件` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
