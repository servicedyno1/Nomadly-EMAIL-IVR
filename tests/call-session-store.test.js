/* global describe, test, expect, beforeEach, jest */
/**
 * call-session-store: in-flight call sessions are mirrored to Mongo so a blue/green cutover
 * (or crash) never drops a live call. Validates write-through, timer stripping, Date revival,
 * warm-load, read-through (by sid AND by data.callControlId) and snapshot.
 */
'use strict'

function fakeMongo() {
  const docs = new Map()
  const _match = (doc, filter) => {
    if (!filter || Object.keys(filter).length === 0) return true
    if (filter.$or) return filter.$or.some(f => _match(doc, f))
    return Object.entries(filter).every(([k, v]) => {
      if (k === 'data.callControlId') return doc.data && doc.data.callControlId === v
      return doc[k] === v
    })
  }
  const col = {
    createIndex: async () => {},
    updateOne: async (filter, update) => { docs.set(filter._id, { _id: filter._id, ...update.$set }) },
    deleteOne: async (filter) => { docs.delete(filter._id) },
    find: (filter) => ({ toArray: async () => [...docs.values()].filter(d => _match(d, filter)) }),
  }
  return { db: { collection: () => col }, docs }
}

const flush = () => new Promise(r => setImmediate(r))

describe('call-session-store', () => {
  let store, mongo
  beforeEach(() => {
    jest.resetModules()
    store = require('../js/call-session-store')
    mongo = fakeMongo()
  })

  test('persist strips timers/_internal fields and functions; remove deletes', async () => {
    await store.init(mongo.db)
    store.persist('activeCalls', 'cc1', {
      chatId: 7, from: '+1', to: '+2', startedAt: new Date('2026-06-01T00:00:00Z'),
      _limitTimer: (() => { const t = setInterval(() => {}, 1e9); t.unref && t.unref(); return t })(), _limitDisconnect: true, fn: () => 1,
    })
    await flush()
    const d = mongo.docs.get('activeCalls:cc1')
    expect(d).toBeTruthy()
    expect(d.kind).toBe('activeCalls')
    expect(d.sid).toBe('cc1')
    expect(d.data.chatId).toBe(7)
    expect('_limitTimer' in d.data).toBe(false)
    expect('_limitDisconnect' in d.data).toBe(false)
    expect('fn' in d.data).toBe(false)
    store.remove('activeCalls', 'cc1')
    await flush()
    expect(mongo.docs.has('activeCalls:cc1')).toBe(false)
  })

  test('loadAll warm-loads into raw stores and revives Date fields (no clobber of live state)', async () => {
    await store.init(mongo.db)
    store.persist('activeCalls', 'cc1', { chatId: 1, startedAt: new Date('2026-06-01T10:00:00Z') })
    store.persist('pendingBridges', 'bridge_9', { chatId: 2, callControlId: 'ccX', createdAt: new Date() })
    await flush()
    const raw = { activeCalls: { cc1: { chatId: 999 } }, pendingBridges: {}, outboundIvrCalls: {}, twilioIvrSessions: {} }
    const n = await store.loadAll(raw)
    expect(n).toBe(1) // cc1 already present → skipped; bridge_9 loaded
    expect(raw.activeCalls.cc1.chatId).toBe(999) // live state NOT clobbered
    expect(raw.pendingBridges.bridge_9.chatId).toBe(2)
    expect(raw.pendingBridges.bridge_9.createdAt instanceof Date).toBe(true) // revived
  })

  test('rehydrate finds a session by sid OR by data.callControlId', async () => {
    await store.init(mongo.db)
    store.persist('outboundIvrCalls', 'ccA', { chatId: 3 })                 // keyed by callControlId
    store.persist('pendingBridges', 'bridge_1', { chatId: 4, callControlId: 'ccB' }) // ref by field
    await flush()
    const raw = { activeCalls: {}, pendingBridges: {}, outboundIvrCalls: {}, twilioIvrSessions: {} }
    expect(await store.rehydrate('ccA', raw)).toBe(1)
    expect(raw.outboundIvrCalls.ccA.chatId).toBe(3)
    expect(await store.rehydrate('ccB', raw)).toBe(1)
    expect(raw.pendingBridges.bridge_1.chatId).toBe(4)
  })

  test('snapshot upserts everything currently in memory (catches nested mutations)', async () => {
    await store.init(mongo.db)
    const raw = {
      activeCalls: { cc1: { chatId: 1, callSid: null } },
      pendingBridges: {}, outboundIvrCalls: {}, twilioIvrSessions: { s1: { chatId: 2 } },
    }
    raw.activeCalls.cc1.callSid = 'CA123' // nested mutation the Proxy can't see
    store.snapshot(raw)
    await flush()
    expect(mongo.docs.get('activeCalls:cc1').data.callSid).toBe('CA123')
    expect(mongo.docs.get('twilioIvrSessions:s1').data.chatId).toBe(2)
  })

  test('all operations no-op safely when the store was never initialised', async () => {
    expect(() => store.persist('activeCalls', 'x', { a: 1 })).not.toThrow()
    expect(() => store.remove('activeCalls', 'x')).not.toThrow()
    const raw = { activeCalls: {}, pendingBridges: {}, outboundIvrCalls: {}, twilioIvrSessions: {} }
    expect(await store.loadAll(raw)).toBe(0)
    expect(await store.rehydrate('x', raw)).toBe(0)
  })
})
