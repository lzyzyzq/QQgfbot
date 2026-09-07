import { describe, it, expect } from 'vitest';
import {
  generatePluginBlockCode,
  injectCodeSegment,
  stripCodeSegment,
  hasUCardSegment,
  assertInjectableSourceFile,
  UCARD_BEGIN,
  UCARD_END,
  UCARD_UNSUPPORTED_MESSAGE,
} from './plugin-codegen';

const CONFIG = {
  show_avatar: true,
  main_page: '主菜单',
  pages: {
    主菜单: {
      blocks: [
        { type: 'title', text: '测试菜单' },
        { type: 'rows', rows: [[{ label: '开', value: 'open', type: 'cmd' }]] },
      ],
    },
  },
};

describe('generatePluginBlockCode', () => {
  it('emits marker-wrapped self-contained JS with config snapshot and helper', () => {
    const seg = generatePluginBlockCode('测试菜单', CONFIG);
    expect(seg.startsWith(UCARD_BEGIN)).toBe(true);
    expect(seg.endsWith(UCARD_END)).toBe(true);
    expect(seg).toContain('var configUniversalMenu =');
    expect(seg).toContain('function renderUniversalMenu(');
    expect(seg).toContain('_m.methods.menuCardReply = async function');
    expect(seg).toContain('engine.renderBlocks');
    expect(seg).toContain('测试菜单');
    // 快照内嵌的 JS 应可独立求值，且 marker 恰好一对
    expect(hasUCardSegment(seg)).toBe(true);
    expect((seg.match(/\/\*__UCARD_BEGIN__\*\//g) || []).length).toBe(1);
    expect((seg.match(/\/\*__UCARD_END__\*\//g) || []).length).toBe(1);
  });
});

describe('injectCodeSegment / stripCodeSegment', () => {
  const source = 'module.exports = {\n  onMessage() { return "hi"; },\n};\n';

  it('appends segment to plain source', () => {
    const seg = generatePluginBlockCode('x', CONFIG);
    const out = injectCodeSegment(source, seg);
    expect(out).toContain(source.trim());
    expect(hasUCardSegment(out)).toBe(true);
    expect((out.match(/\/\*__UCARD_BEGIN__\*\//g) || []).length).toBe(1);
  });

  it('is idempotent: re-injecting replaces the old segment instead of stacking', () => {
    const seg1 = generatePluginBlockCode('x', CONFIG);
    const once = injectCodeSegment(source, seg1);
    const seg2 = generatePluginBlockCode('x', CONFIG);
    const twice = injectCodeSegment(once, seg2);
    expect((twice.match(/__UCARD_BEGIN__/g) || []).length).toBe(1);
    expect((twice.match(/__UCARD_END__/g) || []).length).toBe(1);
  });

  it('stripCodeSegment removes the segment entirely restoring original source', () => {
    const seg = generatePluginBlockCode('x', CONFIG);
    const injected = injectCodeSegment(source, seg);
    const restored = stripCodeSegment(injected);
    expect(hasUCardSegment(restored)).toBe(false);
    expect(restored).toBe(source);
  });

  it('leaves untouched sources without a complete marker pair', () => {
    expect(stripCodeSegment(source)).toBe(source);
    expect(injectCodeSegment(source, '')).toBe(source);
    expect(injectCodeSegment(source)).toBe(source);
  });
});

describe('assertInjectableSourceFile', () => {
  it('allows js/mjs entries', () => {
    expect(() => assertInjectableSourceFile('menu.js')).not.toThrow();
    expect(() => assertInjectableSourceFile('index.mjs')).not.toThrow();
  });

  it('rejects py/php/ts/file resources with the business error message', () => {
    for (const name of ['menu.py', 'index.php', 'src/index.ts', 'archive.zip']) {
      try {
        assertInjectableSourceFile(name);
        expect.unreachable('should throw for ' + name);
      } catch (err: any) {
        expect(err.code).toBe('ERR_UCARD_UNSUPPORTED');
        expect(err.message).toBe(UCARD_UNSUPPORTED_MESSAGE);
      }
    }
  });
});
