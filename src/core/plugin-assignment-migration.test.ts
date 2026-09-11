import { describe, it, expect, beforeEach, vi } from 'vitest'

// 内存假 DB：模拟一次性 PHP/PY 分配迁移所需的查询/写入
const state = vi.hoisted(() => ({
  assigned: [] as Array<{ bot_id: string; plugin_id: string; assigned: number }>,
  plugins: [] as Array<{ id: string }>,
  config: {} as Record<string, string>,
}))

vi.mock('../db/index', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes('DISTINCT bot_id')) {
          const ids = Array.from(new Set(state.assigned.map((r) => r.bot_id)))
          return ids.map((bot_id) => ({ bot_id }))
        }
        if (sql.includes("type IN ('php','py')")) return state.plugins
        return []
      },
      get: () => undefined,
      run: (...args: any[]) => {
        if (sql.includes('INSERT INTO bot_plugins')) {
          const [bot_id, plugin_id] = args
          if (state.assigned.find((r) => r.bot_id === bot_id && r.plugin_id === plugin_id)) {
            return { changes: 0 }
          }
          state.assigned.push({ bot_id, plugin_id, assigned: 1 })
          return { changes: 1 }
        }
        return { changes: 0 }
      },
    }),
  }),
  getConfig: (k: string) => state.config[k] ?? null,
  setConfig: (k: string, v: string) => { state.config[k] = v },
}))

import { migratePhpPyAssignments } from './event-bus'

describe('migratePhpPyAssignments', () => {
  beforeEach(() => {
    state.assigned = []
    state.plugins = []
    state.config = {}
  })

  it('为已有分配记录的机器人补上 PHP/PY 插件分配', () => {
    state.assigned.push({ bot_id: 'b1', plugin_id: 'file-新版菜单', assigned: 1 })
    state.plugins.push({ id: 'php-更新系统' }, { id: 'php-终端' }, { id: 'file-测试' })
    migratePhpPyAssignments()
    const ids = state.assigned.filter((r) => r.bot_id === 'b1').map((r) => r.plugin_id)
    expect(ids).toContain('php-更新系统')
    expect(ids).toContain('php-终端')
    expect(ids).toContain('file-测试')
    expect(ids).toContain('file-新版菜单')
  })

  it('不覆盖已存在的显式分配（含 assigned=0）', () => {
    state.assigned.push({ bot_id: 'b1', plugin_id: 'php-更新系统', assigned: 0 })
    state.plugins.push({ id: 'php-更新系统' })
    migratePhpPyAssignments()
    const row = state.assigned.find((r) => r.bot_id === 'b1' && r.plugin_id === 'php-更新系统')
    expect(row?.assigned).toBe(0)
  })

  it('仅跑一次：第二次调用不再新增', () => {
    state.assigned.push({ bot_id: 'b1', plugin_id: 'file-新版菜单', assigned: 1 })
    state.plugins.push({ id: 'php-更新系统' })
    migratePhpPyAssignments()
    const before = state.assigned.length
    state.plugins.push({ id: 'php-新插件' })
    migratePhpPyAssignments()
    expect(state.assigned.length).toBe(before)
  })

  it('没有处于按分配模式的机器人时不新增记录', () => {
    state.plugins.push({ id: 'php-更新系统' })
    migratePhpPyAssignments()
    expect(state.assigned.length).toBe(0)
  })
})
