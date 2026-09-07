import { describe, it, expect } from 'vitest';
import { builtinReplySpec, renderBranch, linkifyMarkdown, makePreviewData, cfgKeyFor } from './reply-editor';

describe('reply-editor ReplySpec 渲染', () => {
  it('linkifyMarkdown 生成 mqqapi 链接并编码指令', () => {
    const u = linkifyMarkdown('发送「群OpenID查询」', '群OpenID查询');
    expect(u).toContain('[发送「群OpenID查询」](mqqapi://aio/inlinecmd?command=');
    expect(u).toContain('enter=false');
    expect(u).toContain('reply=false');
    expect(u).toContain(encodeURIComponent('群OpenID查询'));
  });

  it('self 分支按真实样例数据渲染完整回复', () => {
    const spec = builtinReplySpec('OpenID查询')!;
    const branch = spec.branches.find(b => b.key === 'self@group')!;
    const d = makePreviewData('测试娱乐', '1905248267', { nick: '海盐诗', qq: '10001' });
    const out = renderBranch(branch, d);
    const lines = out.split('\n');
    expect(lines[0]).toBe('你的 OpenID：');
    expect(lines[1]).toBe('3ADE9500A4F4074CD987367B5109857B');
    expect(lines[2]).toBe('QQ号：10001');
    expect(lines[3]).toBe('昵称：海盐诗');
    expect(lines[4]).toBe('所属机器人：测试娱乐（1905248267）');
    expect(lines[5]).toBe('群 OpenID 请[发送「群OpenID查询」](mqqapi://aio/inlinecmd?command=' + encodeURIComponent('群OpenID查询') + '&enter=false&reply=false)');
  });

  it('hide=true 行在数据缺失时整行隐藏（群内无 QQ 时 QQ 行不出现）', () => {
    const spec = builtinReplySpec('OpenID查询')!;
    const branch = spec.branches.find(b => b.key === 'self@group')!;
    const out = renderBranch(branch, makePreviewData('空空爱追剧', '1905395236', { qq: '', nick: '' }));
    expect(out).not.toContain('QQ号');
    expect(out).not.toContain('昵称');
    const out2 = renderBranch(branch, makePreviewData('空空爱追剧', '1905395236', { qq: '10001', nick: '' }));
    expect(out2).toContain('QQ号：10001');
    expect(out2).not.toContain('昵称');
  });

  it('val 空值回退 fb 提示', () => {
    const spec = builtinReplySpec('OpenID查询')!;
    const branch = spec.branches.find(b => b.key === 'group')!;
    const out = renderBranch(branch, makePreviewData('空空爱追剧', '1905395236', { gid: '' }));
    expect(out).toContain('(未获取到)');
  });

  it('group 分支含你的 OpenID 指引链接', () => {
    const spec = builtinReplySpec('OpenID查询')!;
    const branch = spec.branches.find(b => b.key === 'group')!;
    const out = renderBranch(branch, makePreviewData());
    expect(out).toContain('你的 OpenID 请');
    expect(out).toContain('发送「OpenID查询」');
  });

  it('cfgKeyFor 去掉空格与 py 扩展名', () => {
    expect(cfgKeyFor('OpenID查询')).toBe('plugin.file-OpenID查询.reply');
    expect(cfgKeyFor('测试.py')).toBe('plugin.file-测试.reply');
  });

  it('botShow 跟随机器人名与 ID（重名时仅显示 ID）', () => {
    const spec = builtinReplySpec('OpenID查询')!;
    const branch = spec.branches.find(b => b.key === 'self@c2c')!;
    expect(renderBranch(branch, makePreviewData('空空爱追剧', '1905395236'))).toContain('所属机器人：空空爱追剧（1905395236）');
    expect(renderBranch(branch, makePreviewData('1905395236', '1905395236'))).not.toContain('1905395236（1905395236）');
  });

  it('at 分支有人时输出编号列表、无人时输出引导', () => {
    const spec = builtinReplySpec('OpenID查询')!;
    const at = spec.branches.find(b => b.key === 'at')!;
    const out = renderBranch(at, makePreviewData('', '', { atOpenids: '1. AAAA\n2. BBBB' }));
    expect(out).toContain('被 @ 用户们的 OpenID：');
    expect(out).toContain('1. AAAA\n2. BBBB');
    const empty = spec.branches.find(b => b.key === 'atEmpty')!;
    expect(renderBranch(empty, makePreviewData())).toContain('请 @ 一个用户');
  });

  it('builtinReplySpec 未知插件返回 null', () => {
    expect(builtinReplySpec('不存在插件')).toBeNull();
  });

  it('已收编的全部插件均登记内置模板且各分支可渲染', () => {
    const names = ['OpenID查询', '群主', '充值系统', '绑定管理', '签到系统', '关键词回复', '列表读取', '群信息', '菜单模式', '讲笑话', '问候插件', '实用工具', '娱乐中心'];
    for (const n of names) {
      const spec = builtinReplySpec(n);
      expect(spec, `内置模板缺失：${n}`).not.toBeNull();
      expect(spec!.branches.length, `${n} 分支为空`).toBeGreaterThan(0);
      for (const b of spec!.branches) {
        expect(() => renderBranch(b, makePreviewData()), `${n}::${b.key} 渲染抛错`).not.toThrow();
      }
    }
  });
});
