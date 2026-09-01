import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb, setConfig, getConfig } from '../db/index'
import { createScheduleTask, updateScheduleTask, deleteScheduleTask, listScheduleTasks, setSwitchState, getSwitchState } from './bot-controls'

describe('定时任务体系：自定义 ID / 编辑 / 功能开关', () => {
  beforeEach(() => {
    initDb()
    setConfig('schedule_tasks', '[]')
  })

  it('createScheduleTask：未传 id 时自动生成', () => {
    const r = createScheduleTask({ type: 'broadcast', contentType: 'text', time: '08:00', text: 'hello' })
    expect(r.ok).toBe(true)
    expect(r.task?.id).toBeTruthy()
  })

  it('createScheduleTask：支持自定义 id', () => {
    const r = createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '12:00', id: 'my-chime' })
    expect(r.ok).toBe(true)
    expect(r.task?.id).toBe('my-chime')
    expect(listScheduleTasks().some((t) => t.id === 'my-chime')).toBe(true)
  })

  it('createScheduleTask：自定义 id 重复时报错', () => {
    expect(createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '12:00', id: 'dup' }).ok).toBe(true)
    const r2 = createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '13:00', id: 'dup' })
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('已存在')
  })

  it('createScheduleTask：非法 id 报错', () => {
    const r = createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '12:00', id: 'bad id!' })
    expect(r.ok).toBe(false)
  })

  it('updateScheduleTask：支持修改任务 ID（newId）', () => {
    createScheduleTask({ type: 'broadcast', contentType: 'text', time: '08:00', text: 'a', id: 't1' })
    const r = updateScheduleTask({ id: 't1', newId: 't1-renamed', text: 'b' })
    expect(r.ok).toBe(true)
    expect(r.task?.id).toBe('t1-renamed')
    expect(r.task?.text).toBe('b')
    expect(listScheduleTasks().some((t) => t.id === 't1')).toBe(false)
    expect(listScheduleTasks().some((t) => t.id === 't1-renamed')).toBe(true)
  })

  it('updateScheduleTask：newId 冲突时报错', () => {
    createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '12:00', id: 'a' })
    createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '13:00', id: 'b' })
    const r = updateScheduleTask({ id: 'a', newId: 'b' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已存在')
  })

  it('updateScheduleTask：保留 id 修改其他字段', () => {
    createScheduleTask({ type: 'broadcast', contentType: 'evening', time: '20:00', text: 'old', id: 'e1' })
    const r = updateScheduleTask({ id: 'e1', time: '21:30' })
    expect(r.ok).toBe(true)
    expect(r.task?.id).toBe('e1')
    expect(r.task?.time).toBe('21:30')
  })

  it('deleteScheduleTask：按 id 删除', () => {
    createScheduleTask({ type: 'broadcast', contentType: 'chime', time: '12:00', id: 'del-me' })
    const r = deleteScheduleTask('del-me')
    expect(r.ok).toBe(true)
    expect(listScheduleTasks()).toHaveLength(0)
  })

  it('getSwitchState：默认开启，setSwitchState 后真正关闭生效', () => {
    expect(getSwitchState('chime')).toBe(true)
    expect(getSwitchState('weather_report')).toBe(true)
    setSwitchState('chime', false)
    expect(getSwitchState('chime')).toBe(false)
    expect(getConfig('switch.chime')).toBe('0')
    setSwitchState('chime', true)
    expect(getSwitchState('chime')).toBe(true)
  })
})
