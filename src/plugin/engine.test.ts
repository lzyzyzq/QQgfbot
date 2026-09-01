import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../core/event-bus'
import { PluginEngine } from './engine'
import { PluginSandbox } from './sandbox'
import { initDb, closeDb, getDb } from '../db/index'
import { runWithBotContext } from '../core/bot'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'

const VALID_PLUGIN_CODE = `
module.exports = {
  manifest: {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: 'tester'
  },
  onLoad: function(ctx) {
    ctx.logger.info('Plugin loaded');
  },
  onEnable: function(ctx) {
    ctx.logger.info('Plugin enabled');
  },
  onDisable: function(ctx) {
    ctx.logger.info('Plugin disabled');
  },
  onUnload: function(ctx) {
    ctx.logger.info('Plugin unloaded');
  }
};
`

describe('PluginSandbox', () => {
  it('should validate correct syntax', () => {
    const result = PluginSandbox.validateSyntax('var x = 1;')
    expect(result.valid).toBe(true)
  })

  it('should reject invalid syntax', () => {
    const result = PluginSandbox.validateSyntax('var x = ;')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should validate plugin code format', () => {
    const result = PluginSandbox.validatePluginCode(VALID_PLUGIN_CODE)
    expect(result.valid).toBe(true)
  })

  it('should reject code without module.exports', () => {
    const result = PluginSandbox.validatePluginCode('var x = 1;')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('module.exports')
  })

  it('should reject code without manifest', () => {
    const result = PluginSandbox.validatePluginCode('module.exports = {};')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('manifest')
  })

  it('should load a valid plugin', () => {
    const ctx = {
      bot: {} as any,
      eventBus: new EventBus(),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      storage: { get: () => null, set: () => {}, delete: () => {} },
      config: {},
    }

    const plugin = PluginSandbox.loadPlugin(VALID_PLUGIN_CODE, ctx)
    expect(plugin).not.toBeNull()
    expect(plugin!.manifest.name).toBe('Test Plugin')
  })
})

describe('PluginEngine', () => {
  let engine: PluginEngine
  let eventBus: EventBus
  const testDir = '/tmp/plugin-test-' + uuidv4()

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    initDb()
    eventBus = new EventBus()
    // vitest 环境下 new Function 动态 import 不可用，注入原生 import()
    engine = new PluginEngine(eventBus, {} as any, testDir, (u: string) => import(u))
  })

  afterEach(() => {
    engine.shutdown().catch(() => {})
    closeDb()
  })

  it('should load a plugin from code', async () => {
    const info = await engine.loadFromCode('test-1', 'Test Plugin', VALID_PLUGIN_CODE)
    expect(info.name).toBe('Test Plugin')
    expect(info.loaded).toBe(true)
    expect(info.enabled).toBe(false)
  })

  it('should list plugins', async () => {
    await engine.loadFromCode('test-list', 'List Test', VALID_PLUGIN_CODE)
    const list = engine.list()
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((p) => p.id === 'test-list')).toBe(true)
  })

  it('should enable and disable a plugin', async () => {
    await engine.loadFromCode('test-toggle', 'Toggle Test', VALID_PLUGIN_CODE)
    await engine.enable('test-toggle')
    expect(engine.isEnabled('test-toggle')).toBe(true)

    await engine.disable('test-toggle')
    expect(engine.isEnabled('test-toggle')).toBe(false)
  })

  it('should reload a plugin', async () => {
    await engine.loadFromCode('test-reload', 'Reload Test', VALID_PLUGIN_CODE)
    await engine.reload('test-reload')
    expect(engine.list().some((p) => p.id === 'test-reload')).toBe(true)
  })

  it('should delete a plugin', async () => {
    await engine.loadFromCode('test-delete', 'Delete Test', VALID_PLUGIN_CODE)
    await engine.deletePlugin('test-delete')
    expect(engine.list().some((p) => p.id === 'test-delete')).toBe(false)
  })

  it('should toggle plugin enabled state', async () => {
    await engine.loadFromCode('test-toggle2', 'Toggle2', VALID_PLUGIN_CODE)
    const result1 = await engine.toggleEnabled('test-toggle2')
    expect(result1).toBe(true)
    expect(engine.isEnabled('test-toggle2')).toBe(true)

    const result2 = await engine.toggleEnabled('test-toggle2')
    expect(result2).toBe(false)
    expect(engine.isEnabled('test-toggle2')).toBe(false)
  })

  it('should throw when enabling non-loaded plugin', async () => {
    await expect(engine.enable('nonexistent')).rejects.toThrow()
  })

  it('should throw when loading invalid plugin', async () => {
    await expect(engine.loadFromCode('test-invalid', 'Invalid', 'invalid code')).rejects.toThrow()
  })

  it('derives super_master_id per current bot when same QQ bound to multiple bots', async () => {
    const db = getDb()
    const masterOpenidBot1 = '948C44E2D2D30B8CE0BC95A5E30438D6'
    const masterOpenidBot2 = '735DFD9F16A1CD106F30360567584D5E'
    db.prepare(
      'INSERT OR REPLACE INTO user_mappings (openid, qq_number, nickname, bot_id) VALUES (?, ?, ?, ?)'
    ).run(masterOpenidBot1, '511742399', '海盐诗', '1904787249')
    db.prepare(
      'INSERT OR REPLACE INTO user_mappings (openid, qq_number, nickname, bot_id) VALUES (?, ?, ?, ?)'
    ).run(masterOpenidBot2, '511742399', '海盐诗', '1905395236')

    const code = `
      module.exports = {
        manifest: { id: 'super-derive', name: 'Super Derive', version: '1.0.0', description: 'x', author: 't' },
        onEnable: function(ctx) {
          ctx.eventBus.on('message.c2c', function(data) {
            var host = Object.constructor('return this')();
            host.__SUPER__ = ctx.storage.get('super_master_id');
          });
        }
      };
    `
    await engine.loadFromCode('super-derive', 'Super Derive', code)
    await engine.enable('super-derive')

    const send = async (openid: string) => {
      await eventBus.emit('message.c2c', {
        id: 'm1', content: 'hi',
        author: { id: openid, openid, qqId: '', member_openid: '', username: '海盐诗' },
        timestamp: '0',
      })
    }

    await runWithBotContext('1905395236', async () => {
      await send(masterOpenidBot2)
    })
    expect((global as any).__SUPER__).toBe(JSON.stringify({ id: masterOpenidBot2, name: '海盐诗' }))

    await runWithBotContext('1904787249', async () => {
      await send(masterOpenidBot1)
    })
    expect((global as any).__SUPER__).toBe(JSON.stringify({ id: masterOpenidBot1, name: '海盐诗' }))
  })

  it('should load a TypeScript plugin from a zip directory (index.ts)', async () => {
    const dir = path.join(testDir, 'tsdemo')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.ts'), `
export default {
  manifest: { id: 'tsdemo', name: 'TS Demo', version: '3.0.0', description: 'ts demo', author: 'tester' },
  onEnable: function (ctx: any) { ctx.logger.info('ts enabled'); }
};
`)
    getDb().prepare(
      `INSERT OR REPLACE INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, owner, approved)
       VALUES (?, ?, ?, '', 1, '3.0.0', 'zip', ?, 0, 'system', 1)`
    ).run('tsdemo', 'TS Demo', 'ts demo', dir)

    await engine.enable('tsdemo')
    const info = engine.list().find((p) => p.id === 'tsdemo')
    expect(info).toBeDefined()
    expect(info!.loaded).toBe(true)
    expect(info!.name).toBe('TS Demo')
    expect(info!.version).toBe('3.0.0')
  })

  it('should load a TypeScript plugin from src/index.ts', async () => {
    const dir = path.join(testDir, 'tssrc')
    const srcDir = path.join(dir, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    fs.writeFileSync(path.join(srcDir, 'index.ts'), `
export default {
  manifest: { id: 'tssrc', name: 'TS Src', version: '1.0.0', description: 'ts src', author: 'tester' },
  onEnable: function (ctx: any) { ctx.logger.info('ts src enabled'); }
};
`)
    getDb().prepare(
      `INSERT OR REPLACE INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, owner, approved)
       VALUES (?, ?, ?, '', 1, '1.0.0', 'zip', ?, 0, 'system', 1)`
    ).run('tssrc', 'TS Src', 'ts src', dir)

    await engine.enable('tssrc')
    const info = engine.list().find((p) => p.id === 'tssrc')
    expect(info).toBeDefined()
    expect(info!.loaded).toBe(true)
    expect(info!.name).toBe('TS Src')
  })

  it('should force-reload an already-loaded zip plugin via enable(force)', async () => {
    const dir = path.join(testDir, 'forcezip')
    fs.mkdirSync(dir, { recursive: true })
    const writeEntry = (name: string, version: string) => {
      fs.writeFileSync(path.join(dir, 'index.js'), `
module.exports = {
  manifest: { id: 'forcezip', name: 'Force Zip', version: '${version}', description: 'force', author: 'tester' },
  onEnable: function (ctx) { ctx.logger.info('enabled ' + '${version}'); }
};
`)
    }
    writeEntry('a', '1.0.0')
    getDb().prepare(
      `INSERT OR REPLACE INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, owner, approved)
       VALUES (?, ?, ?, '', 1, '1.0.0', 'zip', ?, 0, 'system', 1)`
    ).run('forcezip', 'Force Zip', 'force', dir)

    await engine.enable('forcezip')
    expect(engine.list().find((p) => p.id === 'forcezip')!.loaded).toBe(true)

    // 覆盖更新入口内容后，enable(id) 不刷新（旧实例已加载）
    writeEntry('b', '2.0.0')
    await engine.enable('forcezip')
    const before = engine.list().find((p) => p.id === 'forcezip')!

    // force=true 强制卸载并重新加载新代码
    await engine.enable('forcezip', true)
    const after = engine.list().find((p) => p.id === 'forcezip')!
    expect(before.loaded).toBe(true)
    expect(after.loaded).toBe(true)
  })
})
