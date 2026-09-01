export type AnyRecord = Record<string, any>;

export interface GroupEvent {
  post_type?: string;
  message_type?: 'group' | 'private' | string;
  notice_type?: string;
  message_id?: string | number;
  user_id?: string | number;
  group_id?: string | number;
  self_id?: string | number;
  raw_message?: string;
  message?: any;
  sender?: AnyRecord;
  time?: number;
}

export interface PluginContext {
  configPath: string;
  dataPath: string;
  adapterName: string;
  pluginManager: AnyRecord;
  actions: { call: (action: string, params?: AnyRecord, adapter?: string, config?: AnyRecord) => Promise<any> };
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void; debug: (...a: any[]) => void };
  NapCatConfig: AnyRecord;
  [key: string]: any;
}
