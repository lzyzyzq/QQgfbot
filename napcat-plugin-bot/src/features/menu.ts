import { state } from '../core/state';
import { sendMsg } from '../core/actions';
import type { PluginContext, GroupEvent } from '../types';

export function buildTextMenu(): string {
  return `【智能机器人菜单】
━━━━━━━━━━━━
📌 基础
  菜单 / 主菜单 / 帮助
  签到 | 补签 | 排行榜 | 个人信息
  群信息 | 群统计
━━━━━━━━━━━━
🎮 娱乐中心
  今日运势 | 今日人品 | 掷骰子 | 猜拳
  选择 | 随机数 | 今天吃什么 | 抽CP
  扫雷 | 敲木鱼 | 开心农场 | 去钓鱼 | 仙逆
━━━━━━━━━━━━
🎵 音乐 / 🌤 工具
  点歌/唱歌 <歌名> | 天气 <城市>
  每日打卡 | 每日备注 <内容> | 设置昵称 <名字>
  查巡 | 群打卡
━━━━━━━━━━━━
⏰ 定时
  添加定时 <HH:MM> <内容>
  定时列表 | 删除定时 <序号>
━━━━━━━━━━━━
👥 群管理
  全员禁言 | 解禁全员
  禁言 @某人 [分钟] | 解禁 @某人
  踢人 @某人 | 设管理 @某人 | 取消管理 @某人
  群公告 <内容> | 设置群名 <名字>
  撤回 <消息ID> | 设为精华 <消息ID> | 戳一戳 @某人
━━━━━━━━━━━━
💡 关键词
  添加关键词 <词> <回复>
  删除关键词 <词> | 关键词列表
━━━━━━━━━━━━
🔑 授权
  获取激活码 | 激活 <授权码> | 授权状态
━━━━━━━━━━━━
⚙️ 管理(主人)
  设置主人 <QQ号> | 主人列表
  开启机器人 | 关闭机器人
  全局开启 | 全局关闭
  频道列表 | 频道测试 | 定时关机 <N>分钟
━━━━━━━━━━━━
ℹ️ 其他
  运行时间 | 版本 | 更新日志 | 赞助 | 问候`;
}

export function buildButtonMenuData(): any {
  const buttons = [
    [{ text: '📌 菜单', data: '菜单', type: 2 }, { text: '🎮 今日运势', data: '今日运势', type: 2 }],
    [{ text: '🎮 掷骰子', data: '掷骰子', type: 2 }, { text: '🎮 今天吃什么', data: '今天吃什么', type: 2 }],
    [{ text: '✅ 签到', data: '签到', type: 2 }, { text: '🏆 排行榜', data: '排行榜', type: 2 }],
    [{ text: '🌤 天气', data: '天气 北京', type: 2 }, { text: '🎵 点歌', data: '点歌 晴天', type: 2 }],
    [{ text: '🎣 去钓鱼', data: '去钓鱼', type: 2 }, { text: '⏰ 敲木鱼', data: '敲木鱼', type: 2 }],
    [{ text: '👆 戳一戳', data: '戳一戳', type: 2 }, { text: '🔑 获取激活码', data: '获取激活码', type: 2 }],
    [{ text: '💡 关键词列表', data: '关键词列表', type: 2 }, { text: '✨ 群打卡', data: '群打卡', type: 2 }],
  ];
  return { rows: buttons, bot_appid: 0 };
}

export async function showMenu(ctx: PluginContext, event: GroupEvent, style: string): Promise<void> {
  const textMenu = buildTextMenu();
  if (style === 'image') {
    const url = state.config.menuImageUrl;
    const file = state.config.menuImagePath;
    if (url || file) {
      const seg = [{ type: 'image', data: url ? { url } : { file } }];
      await sendMsg(ctx, event, seg);
      return;
    }
    await sendMsg(ctx, event, '图片菜单未配置：请在插件配置中填写 menuImageUrl 或 menuImagePath。\n\n' + textMenu);
    return;
  }
  if (style === 'button' && state.config.enableButtonMenu) {
    const data = buildButtonMenuData();
    const seg = [{ type: 'keyboard', data: { content: JSON.stringify(data) } }];
    await sendMsg(ctx, event, seg);
    await sendMsg(ctx, event, textMenu);
    return;
  }
  await sendMsg(ctx, event, textMenu);
}
