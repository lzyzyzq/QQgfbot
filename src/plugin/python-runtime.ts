// Python 插件运行时桥
// 通过子进程执行插件入口 .py，采用 NDJSON 行协议双向通信：
//   Node -> Python: {op:'ping'} / {op:'enable'} / {op:'disable'} / {op:'event',data} / {op:'result',id,data,error}
//   Python -> Node: {op:'pong'} / {op:'reply',data} / {op:'call',id,method,args} / {op:'log',text}
// 回复采用 reply 消息交由 Node 端通过 BotAPI 发送；Python 端也可用 call 主动调用 BotAPI 并同步等待结果。
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('py-plugin');

export interface PyReplyPayload {
  type?: string;
  target?: string;
  openid?: string;
  text?: string;
  botId?: string;
}

/** Python 插件可额外调用的引擎能力（通过 call(method, args) 以 JSON 参数/返回值调用） */
export interface PyEngineExtras {
  /** 全部群 OpenID 列表（groups 表） */
  listGroups?: () => string[];
  /** QQ 号 → 绑定的 OpenID（无绑定返回 null） */
  openidByQq?: (qq: string) => string | null;
  /** 群内按昵称查成员 OpenID（无匹配返回 null） */
  nicknameToOpenid?: (groupId: string, nickname: string) => string | null;
  /** 指定 OpenID 是否为超级主人 */
  isSuper?: (openid: string) => boolean;
  /** 读全局用户自定义变量（config plugin.vars） */
  getVariable?: (name: string) => string | null;
  /** 读本插件在 menu-editor.html 中按 appid 保存的卡片/菜单布局配置（未配置返回 null） */
  getMenuConfig?: (appid: string) => any;
  /** 云端广播任务列表（broadcast/broadcast.json，多源拉取） */
  broadcastList?: () => Promise<any>;
  /** 立即执行云端广播：参数 (taskId, target?, groupId?)，target: all|one/group|this|list */
  broadcastSend?: (taskId: string, target?: string, groupId?: string) => Promise<any>;
}

export class PythonRuntime {
  private proc: ChildProcess | null = null;
  private buf = '';
  private callSeq = 1;
  private resultWaiters = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private ready = false;
  private stopping = false;

  constructor(
    private entry: string,
    private botApi: any,
    private onLog: (line: string) => void,
    private pythonBin = 'python3',
    private extras?: PyEngineExtras
  ) {}

  async start(): Promise<void> {
    if (this.proc) return;
    this.stopping = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e: Error) => { if (!settled) { settled = true; reject(e); } };
      let proc: ChildProcess;
      try {
        proc = spawn(this.pythonBin, [this.entry], {
          cwd: path.dirname(this.entry),
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });
      } catch (e: any) {
        fail(new Error(`无法启动 python3: ${e.message}`));
        return;
      }
      this.proc = proc;

      const timeout = setTimeout(() => fail(new Error(`Python 插件启动超时（${this.entry}）`)), 15000);

      proc.on('error', (e) => fail(new Error(`python3 启动失败: ${e.message}`)));

      proc.stdout!.on('data', (chunk: Buffer) => {
        this.buf += chunk.toString();
        let idx: number;
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (line) this.handleLine(line);
        }
      });

      proc.stderr!.on('data', (chunk: Buffer) => {
        const s = String(chunk);
        this.onLog(s.trimEnd());
        logger.warn(`[py] ${s.trimEnd()}`);
      });

      proc.on('exit', (code, signal) => {
        this.proc = null;
        this.ready = false;
        if (!this.stopping) {
          this.onLog(`Python 插件进程退出 code=${code} signal=${signal}`);
          logger.warn(`Python plugin ${this.entry} exited code=${code} signal=${signal}`);
        }
        for (const w of this.resultWaiters.values()) w.reject(new Error('Python 插件进程已退出'));
        this.resultWaiters.clear();
        fail(new Error(`Python 插件进程退出（code=${code}）`));
      });

      // 等待 pong 确认就绪
      const check = setInterval(() => {
        if (this.ready) {
          clearInterval(check);
          clearTimeout(timeout);
          if (!settled) { settled = true; resolve(); }
        }
      }, 150);

      this.write({ op: 'ping' });
      setTimeout(() => this.write({ op: 'enable' }), 100);
    });
  }

  private handleLine(line: string): void {
    let msg: any;
    try { msg = JSON.parse(line); } catch { this.onLog('[py] ' + line); return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.op) {
      case 'pong':
        this.ready = true;
        return;
      case 'log':
        this.onLog(String(msg.text || ''));
        return;
      case 'reply':
        this.executeReply(msg.data || {}).catch((e) => logger.error(`py reply error: ${e.message}`));
        return;
      case 'call':
        this.executeCall(msg).catch((e) => logger.error(`py call error: ${e.message}`));
        return;
      default:
        return;
    }
  }

  private async executeReply(d: PyReplyPayload): Promise<void> {
    const type = d.type || '';
    const target = d.target;
    const text = String(d.text || '');
    if (!target || !text) return;
    try {
      if (type === 'message.group') {
        if (this.botApi && typeof this.botApi.sendGroupMessage === 'function') {
          await this.botApi.sendGroupMessage(target, text);
          return;
        }
      } else if (type === 'message.c2c') {
        const openid = d.openid || target;
        if (this.botApi && typeof this.botApi.sendPrivateMessage === 'function') {
          await this.botApi.sendPrivateMessage(openid, text);
          return;
        }
      } else if (type === 'message.guild') {
        if (this.botApi && typeof this.botApi.sendMessage === 'function') {
          await this.botApi.sendMessage(target, text);
          return;
        }
      }
      // 兜底
      if (this.botApi && typeof this.botApi.sendGroupMessage === 'function') {
        await this.botApi.sendGroupMessage(target, text);
      }
    } catch (e: any) {
      this.onLog(`[py] 发送失败: ${e.message}`);
      logger.error(`[py] reply send failed: ${e.message}`);
    }
  }

  private async executeCall(msg: any): Promise<void> {
    const method = String(msg.method || '');
    const args = Array.isArray(msg.args) ? msg.args : [];
    let data: any = null;
    let error: string | null = null;
    try {
      const fn = this.botApi && (this.botApi as any)[method];
      if (typeof fn === 'function') {
        data = await fn.apply(this.botApi, args);
      } else if (this.extras && typeof (this.extras as any)[method] === 'function') {
        data = await (this.extras as any)[method](...args);
      } else {
        throw new Error(`BotAPI 无方法 ${method}`);
      }
    } catch (e: any) {
      error = e.message || String(e);
    }
    this.write({ op: 'result', id: msg.id, data, error });
  }

  dispatch(event: Record<string, any>): void {
    if (!this.proc) return;
    this.write({ op: 'event', data: event });
  }

  private write(obj: any): void {
    try {
      if (this.proc && this.proc.stdin && this.proc.stdin.writable) {
        this.proc.stdin.write(JSON.stringify(obj) + '\n');
      }
    } catch {}
  }

  stop(): void {
    this.stopping = true;
    try {
      if (this.proc) this.write({ op: 'disable' });
    } catch {}
    if (this.proc) {
      const p = this.proc;
      if (p.stdin) { try { p.stdin.end(); } catch {} }
      const killTimer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 1500);
      killTimer.unref();
      try { p.kill('SIGTERM'); } catch {}
    }
    this.proc = null;
    this.ready = false;
    this.resultWaiters.clear();
  }

  isRunning(): boolean {
    return !!this.proc;
  }
}
