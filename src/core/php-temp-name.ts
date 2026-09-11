import { createHash } from 'crypto';

// 生成注入临时文件名（不含目录）。
// 必须对「完整路径」取哈希：纯中文名插件（复读.php、终端.php）经字符过滤后会得到
// 相同名字并互相覆盖，导致执行 A 实际跑的是 B（表现为某些中文插件彻底无反应）。
export function phpTempFileName(file: string): string {
  const hash = createHash('md5').update(String(file)).digest('hex').slice(0, 12);
  return `__php_${hash}.php`;
}
