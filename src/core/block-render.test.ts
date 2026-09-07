import { describe, it, expect } from 'vitest';
import { renderBlocksToMarkdown, configToJs } from './block-render';

describe('renderBlocksToMarkdown', () => {
  it('returns empty string on dirty/empty inputs', () => {
    expect(renderBlocksToMarkdown(null as any)).toBe('');
    expect(renderBlocksToMarkdown(undefined as any)).toBe('');
    expect(renderBlocksToMarkdown([] as any)).toBe('');
    expect(renderBlocksToMarkdown({} as any)).toBe('');
    expect(renderBlocksToMarkdown('nope' as any)).toBe('');
    expect(renderBlocksToMarkdown([{ type: 'ghost' }] as any)).toBe('');
    expect(renderBlocksToMarkdown([null, 42, { type: '' }] as any)).toBe('');
  });

  it('renders common blocks in order with padding/links', () => {
    const md = renderBlocksToMarkdown([
      { type: 'title', text: '测试菜单', align: 'center' },
      { type: 'divider' },
      { type: 'intro', text: '欢迎使用测试菜单' },
      {
        type: 'rows',
        rows: [
          [
            { label: '功能一', value: 'func1', type: 'cmd' },
            { label: '功能二', value: 'func2', type: 'cmd_auto' },
          ],
          [{ label: '官网', value: 'https://example.com', type: 'link' }],
        ],
      },
      { type: 'tips', text: '回复功能名可直达' },
      { type: 'footer_title', text: '—— 说明 ——' },
      { type: 'footer', lines: ['更新时间：{time}', '本卡片由 M3 生成'], fence: 'text' },
    ]);
    // title 居中补全角空格
    expect(md).toContain('　　测试菜单');
    expect(md).toContain('━━━━━━━━━━━━━━');
    expect(md).toContain('欢迎使用测试菜单');
    // 行内单元格以全角分隔符拼接
    expect(md).toContain('[功能一](mqqapi://aio/%69nlinecmd?command=func1&enter=false&reply=false)　|　[功能二](mqqapi://aio/%69nlinecmd?command=func2&enter=true&reply=false)');
    expect(md).toContain('[官网](https://example.com)');
    // tips 前带空行
    expect(md).toContain('\n\n回复功能名可直达');
    expect(md).toContain('—— 说明 ——');
    // footer 围栏
    expect(md).toContain('```text\n更新时间：');
    expect(md).toContain('```');
  });

  it('replaces {time} with Beijing time (UTC+8) and honours opts.now', () => {
    const md = renderBlocksToMarkdown(
      [{ type: 'footer', lines: ['生成于 {time}'], fence: '' }],
      undefined,
      undefined,
      { now: new Date('2026-09-07T02:00:00Z') },
    );
    expect(md).toContain('生成于 2026-09-07 10:00:00');
  });

  it('renders the main_page page when given a whole-card config', () => {
    const md = renderBlocksToMarkdown({
      show_avatar: true,
      main_page: 'A',
      pages: {
        A: { blocks: [{ type: 'title', text: '页面A' }] },
        B: { blocks: [{ type: 'title', text: '页面B' }] },
      },
    });
    expect(md).toContain('页面A');
    expect(md).not.toContain('页面B');
  });

  it('renders meta info lines from data + engine context', () => {
    const engineStub: any = {
      getUserProfile: () => ({ nickname: '资料昵称', qq_number: '12345', avatar: 'https://avatar.example/1.png' }),
      getGroupName: () => '功能群',
      getGroupNumber: () => '88888',
      getGroupMemberRole: () => 'admin',
    };
    const data: any = { author: { openid: 'u_1' }, groupId: 'g_1' };
    const md = renderBlocksToMarkdown(
      [{ type: 'meta', meta_fields: [{ key: 'nickname' }, { key: 'userid' }, { key: 'group' }, { key: 'role' }] }],
      { engine: engineStub },
      data,
    );
    expect(md).toContain('👤 昵称：资料昵称（QQ: 12345）');
    expect(md).toContain('🆔 用户ID：u_1');
    expect(md).toContain('👥 群信息：功能群（群号：88888）');
    expect(md).toContain('🔑 群内权限：管理员');
  });

  it('omits group-dependent meta rows when no group context is provided', () => {
    const md = renderBlocksToMarkdown(
      [{ type: 'meta', meta_fields: [{ key: 'group' }, { key: 'role' }] }],
      undefined,
      { author: { openid: 'u_1' } },
    );
    expect(md).toBe('');
  });

  it('renders avatar rows with clamped size defaults', () => {
    const engineStub: any = {
      getUserProfile: () => ({ nickname: '头像用户', avatar: 'https://avatar.example/a.png' }),
    };
    const md = renderBlocksToMarkdown(
      [{ type: 'avatar', source: 'fixed', value: 'https://avatar.example/f.png', width: 300, height: 100 }],
      { engine: engineStub },
      { author: { openid: 'u_1' } },
    );
    expect(md).toContain('![头像 #300px #100px](https://avatar.example/f.png)');
  });

  it('groups single-line children into one row via separator', () => {
    const md = renderBlocksToMarkdown([
      {
        type: '__group',
        children: [
          { type: 'title', text: '左' },
          { type: 'title', text: '右' },
        ],
      },
    ]);
    expect(md).toContain('左　|　右');
  });
});

describe('configToJs', () => {
  it('serialises whole-card config into a valid JS object literal', () => {
    const out = configToJs({
      show_avatar: false,
      main_page: '主菜单',
      pages: { 主菜单: { blocks: [{ type: 'title', text: 'hello' }] } },
    });
    expect(out).toContain('main_page:');
    const obj: any = new Function('return ' + out + ';')();
    expect(obj.pages['主菜单'].blocks.length).toBe(1);
    expect(obj.main_page).toBe('主菜单');
  });

  it('wraps bare block arrays into a single default page', () => {
    const out = configToJs([{ type: 'title', text: 'hello' }]);
    const obj: any = new Function('return ' + out + ';')();
    expect(obj.main_page).toBe('主菜单');
    expect(obj.pages['主菜单'].blocks.length).toBe(1);
  });

  it('returns {} literal for invalid input', () => {
    expect(configToJs(null)).toBe('{}');
    expect(configToJs(undefined)).toBe('{}');
    expect(configToJs(42 as any)).toBe('{}');
  });
});
