import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from './event-bus'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  it('should register a listener and return an id', () => {
    const id = bus.on('test.event', () => {})
    expect(id).toBeDefined()
    expect(typeof id).toBe('string')
  })

  it('should emit events to registered listeners', async () => {
    const results: string[] = []
    bus.on('test.event', (data) => results.push('first:' + data.msg))
    bus.on('test.event', (data) => results.push('second:' + data.msg))

    await bus.emit('test.event', { msg: 'hello' })

    expect(results).toHaveLength(2)
    expect(results).toContain('first:hello')
    expect(results).toContain('second:hello')
  })

  it('should not call listeners for different events', async () => {
    const results: string[] = []
    bus.on('test.a', () => results.push('a'))

    await bus.emit('test.b', {})

    expect(results).toHaveLength(0)
  })

  it('should remove listener by id', async () => {
    const results: string[] = []
    bus.on('test.event', () => results.push('a'))
    const id = bus.on('test.event', () => results.push('b'))
    bus.on('test.event', () => results.push('c'))

    bus.off(id)
    await bus.emit('test.event', {})

    expect(results).toHaveLength(2)
    expect(results).toEqual(['a', 'c'])
  })

  it('should isolate errors in listeners', async () => {
    const results: string[] = []
    bus.on('test.event', () => { throw new Error('crash') })
    bus.on('test.event', (data) => results.push(data.msg))

    await bus.emit('test.event', { msg: 'recovered' })

    expect(results).toHaveLength(1)
    expect(results[0]).toBe('recovered')
  })

  it('should return correct listener count', () => {
    bus.on('test.a', () => {})
    bus.on('test.a', () => {})
    bus.on('test.b', () => {})

    expect(bus.getListenerCount('test.a')).toBe(2)
    expect(bus.getListenerCount('test.b')).toBe(1)
    expect(bus.getListenerCount()).toBe(3)
    expect(bus.getListenerCount('nonexistent')).toBe(0)
  })

  it('should remove all listeners', () => {
    bus.on('test.a', () => {})
    bus.on('test.b', () => {})

    bus.removeAll()

    expect(bus.getListenerCount()).toBe(0)
  })

  it('should handle async listeners', async () => {
    const results: string[] = []
    bus.on('test.event', async (data) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      results.push(data.msg)
    })

    await bus.emit('test.event', { msg: 'async' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(results).toHaveLength(1)
    expect(results[0]).toBe('async')
  })

  it('should handle emit with no listeners', async () => {
    await expect(bus.emit('nonexistent', {})).resolves.toBeUndefined()
  })
})
