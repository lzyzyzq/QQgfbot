import { describe, it, expect, beforeEach, vi } from 'vitest'

// 内存假 DB：只模拟分配/群开关相关的三条查询，避免测试污染真实 bot.db
const state = vi.hoisted(() => ({
  assigned: [] as Array<{ bot_id: string; plugin_id: string; assigned: number }>,
  groups: [] as Array<{ plugin_id: string; group_id: string; mode: string }>,
}))

vi.mock('../db/index', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: any[]) => {
        if (sql.includes('FROM bot_plugins')) {
          const [botId, pluginId] = args
          return state.assigned.find((r) => r.bot_id === botId && r.plugin_id === pluginId)
        }
        if (sql.includes("mode = 'allow'")) {
          const [pluginId] = args
          const c = state.groups.filter((x) => x.plugin_id === pluginId && x.mode === 'allow').length
          return { c }
        }
        if (sql.includes('FROM plugin_group_config')) {
          const [pluginId, groupId] = args
          const r = state.groups.find((x) => x.plugin_id === pluginId && x.group_id === groupId)
          return r ? { mode: r.mode } : undefined
        }
        return undefined
      },
      all: () => [],
      run: () => ({ changes: 0 }),
    }),
  }),
  getConfig: () => '',
}))

import {
  pluginAllowedForEvent,
  markBotHasAssignment,
  resetAssignmentCache,
  resetGroupPolicyCache,
} from './event-bus'

describe('pluginAllowedForEvent (按机器人分配 + 按群开关)', () => {
  beforeEach(() => {
    state.assigned = []
    state.groups = []
    resetAssignmentCache()
    resetGroupPolicyCache()
  })

  it('无任何分配记录时为全局模式：放行', () => {
    expect(pluginAllowedForEvent('php-更新系统', 'botGlobal', 'message.group', 'g1')).toBe(true)
  })

  it('per-bot 模式下未勾选（无记录）一律不跑', () => {
    markBotHasAssignment('b1')
    expect(pluginAllowedForEvent('php-更新系统', 'b1', 'message.group', 'g1')).toBe(false)
  })

  it('per-bot 模式下已分配(assigned=1)放行', () => {
    markBotHasAssignment('b1')
    state.assigned.push({ bot_id: 'b1', plugin_id: 'php-更新系统', assigned: 1 })
    expect(pluginAllowedForEvent('php-更新系统', 'b1', 'message.group', 'g1')).toBe(true)
  })

  it('per-bot 模式下显式未分配(assigned=0)不跑', () => {
    markBotHasAssignment('b1')
    state.assigned.push({ bot_id: 'b1', plugin_id: 'php-更新系统', assigned: 0 })
    expect(pluginAllowedForEvent('php-更新系统', 'b1', 'message.group', 'g1')).toBe(false)
  })

  it('插件存在 allow 白名单：未命中群不跑，命中群放行', () => {
    markBotHasAssignment('b1')
    state.assigned.push({ bot_id: 'b1', plugin_id: 'p1', assigned: 1 })
    state.groups.push({ plugin_id: 'p1', group_id: 'g1', mode: 'allow' })
    expect(pluginAllowedForEvent('p1', 'b1', 'message.group', 'g2')).toBe(false)
    expect(pluginAllowedForEvent('p1', 'b1', 'message.group', 'g1')).toBe(true)
  })

  it('插件在指定群 deny：该群不跑，其他群放行', () => {
    markBotHasAssignment('b1')
    state.assigned.push({ bot_id: 'b1', plugin_id: 'p1', assigned: 1 })
    state.groups.push({ plugin_id: 'p1', group_id: 'g1', mode: 'deny' })
    expect(pluginAllowedForEvent('p1', 'b1', 'message.group', 'g1')).toBe(false)
    expect(pluginAllowedForEvent('p1', 'b1', 'message.group', 'g2')).toBe(true)
  })

  it('私聊/频道事件不触发按群开关', () => {
    markBotHasAssignment('b1')
    state.assigned.push({ bot_id: 'b1', plugin_id: 'p1', assigned: 1 })
    state.groups.push({ plugin_id: 'p1', group_id: 'g1', mode: 'allow' })
    expect(pluginAllowedForEvent('p1', 'b1', 'message.c2c', 'g1')).toBe(true)
  })

  it('pluginId 为空时放行（避免误杀内置流程）', () => {
    expect(pluginAllowedForEvent('', 'b1', 'message.group', 'g1')).toBe(true)
  })
})
