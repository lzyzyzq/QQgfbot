// WebUI 配置 Schema 说明（面板 webui/index.html 使用）
export const webuiSchema = {
  title: '统一菜单插件配置',
  fields: [
    { key: 'globalMode', label: '全局模式', type: 'select', options: ['text', 'image'], default: 'text', note: 'text=文字模式（蓝色字体↗）/ image=图片菜单' },
    { key: 'welcomeEnabled', label: '入群欢迎提示', type: 'bool', default: true },
    { key: 'chimeMode', label: '报时模式', type: 'select', options: ['text', 'image'], default: 'text' },
    { key: 'chimeEnabled', label: '整点报时', type: 'bool', default: false },
    { key: 'aiKey', label: 'AI 密钥（用户自备）', type: 'password', default: '' },
    { key: 'aiBaseUrl', label: 'AI 接口地址', type: 'text', default: 'https://api.deepseek.com/v1' },
    { key: 'aiModel', label: 'AI 模型', type: 'text', default: 'deepseek-chat' },
  ],
  modules: [
    'menu', 'random', 'games', 'learn', 'ai', 'chime', 'welcome',
    'util', 'auth', 'sys', 'setting', 'groupadm', 'guildadm',
  ],
};
