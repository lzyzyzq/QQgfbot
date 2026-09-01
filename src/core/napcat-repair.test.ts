import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { initDb, getDb } from '../db/index'
import { moveNapcatMember, renameNapcatMember, removeMemberBinding, addNapcatMember } from './napcat'

describe('OpenID 修复后端能力', () => {
  let db: Database.Database

  beforeAll(() => {
    db = initDb()
    db.exec(`DELETE FROM group_members; DELETE FROM user_mappings; DELETE FROM auth_codes; DELETE FROM groups;`)
  })

  afterAll(() => {
    try { db.exec(`DELETE FROM group_members; DELETE FROM user_mappings; DELETE FROM auth_codes; DELETE FROM groups;`) } catch {}
  })

  it('moveNapcatMember：把 openid 从错误群移到正确群并删除其他群记录', () => {
    addNapcatMember({ openid: 'oidA', groupOpenid: 'groupWrong', nickname: '张三', botId: 'bot1' })
    const r = moveNapcatMember('oidA', 'groupRight', { botId: 'bot2' })
    expect(r.moved).toBe(true)
    const inWrong = db.prepare('SELECT 1 FROM group_members WHERE member_openid=? AND group_id=?').get('oidA', 'groupWrong')
    expect(inWrong).toBeUndefined()
    const inRight = db.prepare('SELECT bot_id, qq_id FROM group_members WHERE member_openid=? AND group_id=?').get('oidA', 'groupRight')
    expect(inRight).toBeDefined()
    expect((inRight as any).bot_id).toBe('bot2')
  })

  it('moveNapcatMember：removeOthers=false 时保留其他群记录', () => {
    addNapcatMember({ openid: 'oidB', groupOpenid: 'g1', nickname: '李四' })
    addNapcatMember({ openid: 'oidB', groupOpenid: 'g2', nickname: '李四' })
    moveNapcatMember('oidB', 'g2', { removeOthers: false, botId: 'botX' })
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=? AND group_id=?').get('oidB', 'g1')).toBeDefined()
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=? AND group_id=?').get('oidB', 'g2')).toBeDefined()
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=? AND group_id=?').get('oidB', 'g2')).toBeDefined()
  })

  it('renameNapcatMember：全库替换 openid（group_members / user_mappings / auth_codes.used_by）', () => {
    addNapcatMember({ openid: 'oidOld', groupOpenid: 'gx', qq: '10001', nickname: '王五', botId: 'botZ' })
    getDb().prepare("INSERT INTO auth_codes (code, role, used_by, created_by) VALUES ('ABCD1234', 'member', 'oidOld', 'admin')").run()
    const r = renameNapcatMember('oidOld', 'oidNew')
    expect(r.renamed).toBeGreaterThan(0)
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=?').get('oidOld')).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=?').get('oidNew')).toBeDefined()
    expect(db.prepare('SELECT 1 FROM user_mappings WHERE openid=?').get('oidOld')).toBeUndefined()
    expect(db.prepare('SELECT qq_number FROM user_mappings WHERE openid=?').get('oidNew')).toBeDefined()
    expect(db.prepare("SELECT 1 FROM auth_codes WHERE used_by=?").get('oidNew')).toBeDefined()
  })

  it('renameNapcatMember：目标 openid 已在同群时合并删除冲突记录', () => {
    addNapcatMember({ openid: 'dup1', groupOpenid: 'gc', nickname: '冲突' })
    addNapcatMember({ openid: 'dup2', groupOpenid: 'gc', nickname: '冲突' })
    renameNapcatMember('dup1', 'dup2')
    const rows = db.prepare('SELECT member_openid FROM group_members WHERE group_id=?').all('gc') as any[]
    expect(rows.filter((x: any) => x.member_openid === 'dup2')).toHaveLength(1)
  })

  it('removeMemberBinding：指定 group_id 时仅删除该群记录，保留 QQ 绑定与其他群', () => {
    addNapcatMember({ openid: 'oidC', groupOpenid: 'ga', qq: '10002', nickname: '赵六' })
    addNapcatMember({ openid: 'oidC', groupOpenid: 'gb', nickname: '赵六' })
    removeMemberBinding('oidC', 'ga')
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=? AND group_id=?').get('oidC', 'ga')).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM group_members WHERE member_openid=? AND group_id=?').get('oidC', 'gb')).toBeDefined()
    expect(db.prepare('SELECT qq_number FROM user_mappings WHERE openid=?').get('oidC')).toBeDefined()
  })
})
