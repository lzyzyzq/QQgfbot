import { getConfig } from '../db/index';

// 插件回复 PHP 模板：`<php? 输出内容 php>`
// 提取标记内的内容作为正文，末尾自动追加尾部信息（bot.footer_text，是什么就是什么）+ 底部广告（bot.footer_ads 随机一行）
export function applyPhpTemplate(text: string): string {
  if (!text || text.indexOf('<php?') < 0) return text;
  const start = text.indexOf('<php?');
  const end = text.indexOf('php>', start + 5);
  if (end < 0) return text;
  let inner = text.substring(start + 5, end);
  const footerText = (getConfig('bot.footer_text') || 'PHP · QQ机器人平台').trim();
  let ad = '';
  try {
    const ads = String(getConfig('bot.footer_ads') || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s);
    if (ads.length) ad = ads[Math.floor(Math.random() * ads.length)];
  } catch {}
  inner = inner.trim();
  return inner + '\n' + footerText + (ad ? '\n' + ad : '');
}
