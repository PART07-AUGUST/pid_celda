import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const root = process.cwd()
const code = readFileSync(join(root, 'src/state-function.js'), 'utf8')

function harness() {
  let stored
  let now = 1_000_000
  function send(topic, payload) {
    const sandbox = {
      msg: { topic, payload },
      flow: { get: () => stored, set: (_, value) => { stored = value } },
      node: { status: () => {} },
      Date: class extends Date { static now () { return now } }
    }
    return vm.runInNewContext(`(function(){${code}\n})()`, sandbox)
  }
  return { send, advance: ms => { now += ms }, get state () { return stored } }
}

test('mantiene los nueve tags PID y limita los ajustes a 0–100', () => {
  const h = harness()
  const view = h.send('tick').payload
  assert.deepEqual(Object.keys(view.values), [
    'SP_Nivel', 'PV_Nivel', 'Salida_PID', 'Kp', 'Ki', 'Kd',
    'PID_Habilitado', 'Diferencia_Nivel', 'Cambio_Nivel'
  ])
  h.send('command', { tag: 'SP_Nivel', value: 101 })
  assert.equal(h.state.values.SP_Nivel, 60)
  h.send('command', { tag: 'Kp', value: 4.5 })
  assert.equal(h.state.values.Kp, 4.5)
  h.send('command', { tag: 'Ki', value: -1 })
  assert.equal(h.state.values.Ki, 0.1)
})

test('el PID cambia su salida y la planta simulada se acerca a la consigna', () => {
  const h = harness()
  h.send('command', { tag: 'PID_Habilitado', value: true })
  let view = h.send('tick').payload
  assert.ok(view.values.Salida_PID > 50)
  const initialError = Math.abs(view.error)
  for (let i = 0; i < 60; i++) {
    h.advance(1000)
    view = h.send('tick').payload
  }
  assert.ok(view.values.PV_Nivel > 50)
  assert.ok(Math.abs(view.values.Diferencia_Nivel - (view.values.SP_Nivel - view.values.PV_Nivel)) < 1e-9)
  assert.ok(Number.isFinite(view.values.Cambio_Nivel))
  assert.ok(Math.abs(view.error) < initialError)
  assert.ok(view.values.Salida_PID >= 0 && view.values.Salida_PID <= 100)
})

test('al deshabilitar el PID se retiene la salida actual', () => {
  const h = harness()
  h.send('command', { tag: 'PID_Habilitado', value: true })
  h.advance(1000)
  h.send('tick')
  const output = h.state.values.Salida_PID
  h.send('command', { tag: 'PID_Habilitado', value: false })
  h.advance(1000)
  const view = h.send('tick').payload
  assert.equal(view.values.PID_Habilitado, false)
  assert.equal(view.values.Salida_PID, output)
})

test('el flujo importable solo contiene Node-RED y los tags PID', () => {
  const flow = JSON.parse(readFileSync(join(root, 'flows.json'), 'utf8'))
  const ids = new Set(flow.map(node => node.id))
  assert.equal(ids.size, flow.length)
  assert.equal(flow.some(node => node.type.startsWith('OpcUa')), false)
  assert.equal(flow.some(node => node.type === 'ui-template'), true)
  assert.equal(flow.find(node => node.type === 'ui-base').path, '/dashboard')
  assert.equal(flow.find(node => node.type === 'ui-page').path, '')
  for (const node of flow) {
    for (const outputs of node.wires || []) {
      for (const target of outputs) assert.ok(ids.has(target), `referencia ${target} desconocida`)
    }
  }
})
