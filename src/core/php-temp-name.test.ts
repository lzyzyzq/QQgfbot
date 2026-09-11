import { describe, it, expect } from 'vitest';
import { phpTempFileName } from './php-temp-name';

describe('phpTempFileName', () => {
  it('中文名插件生成唯一临时文件名，避免互相覆盖', () => {
    const files = [
      '/app/plugins/复读.php',
      '/app/plugins/终端.php',
      '/app/plugins/更新系统.php',
      '/app/plugins/群信息.php',
    ];
    const names = files.map(phpTempFileName);
    expect(new Set(names).size).toBe(files.length);
  });

  it('同一路径稳定复用同名文件', () => {
    expect(phpTempFileName('/app/plugins/复读.php')).toBe(phpTempFileName('/app/plugins/复读.php'));
  });

  it('同名文件位于不同目录时不冲突', () => {
    expect(phpTempFileName('/a/index.php')).not.toBe(phpTempFileName('/b/index.php'));
  });
});
