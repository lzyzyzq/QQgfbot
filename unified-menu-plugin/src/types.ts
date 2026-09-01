export type GlobalMode = 'text' | 'image';

export interface MenuNode {
  id: string;
  label: string;
  action?: string;
  children?: MenuNode[];
}

export interface Envelope {
  type: string;
  botId?: string;
  groupId?: string;
  channelId?: string;
  userId?: string;
  content?: string;
  msgId?: string;
  raw?: any;
}

export interface CtxLike {
  pluginId?: string;
  bot: any;
  eventBus?: any;
  logger: any;
  storage: any;
  engine: any;
  [k: string]: any;
}
