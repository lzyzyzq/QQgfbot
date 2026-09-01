import http from 'http';
import https from 'https';

export function stripCQ(text: any): string {
  return String(text).replace(/\[CQ:[^\]]*\]/g, '').trim();
}

export function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function seededRandom(seedStr: string): () => number {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = ((h << 5) - h + seedStr.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h * 1664525 + 1013904223) & 0xffffffff;
    return (h >>> 0) % 1000 / 1000;
  };
}

export function pickRandomFromList<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickWeighted<T extends { weight: number }>(list: T[], rand: () => number): T {
  const total = list.reduce((s, it) => s + it.weight, 0);
  let r = rand() * total;
  for (const it of list) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return list[list.length - 1];
}

export function httpGet(url: string, timeout = 8000): Promise<any> {
  return httpRequest(url, { method: 'GET', timeout });
}

export function httpRequest(url: string, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const method = (options.method || 'GET').toUpperCase();
    let payload: Buffer | null = null;
    const headers: Record<string, string> = {};
    if (options.body !== undefined && options.body !== null) {
      payload = Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.byteLength);
    }
    const req = mod.request(url, { method, timeout: options.timeout || 8000, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') })
      );
    });
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}
