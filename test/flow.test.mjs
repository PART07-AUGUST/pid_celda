import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const root = process.cwd()
const code = readFileSync(join(root, 'src/state-function.js'), 'utf8')
const tags = [
  'Nivel_Pulpa', 'Caudal_Aire', 'Dosificacion_Reactivo', 'Agitador_ON',
  'Recuperacion_Estimada', 'Alarma_Nivel', 'Simulacion_Activa',
  'Orden_Star', 'Orden_Stop', 'Proceso_Activo'
]

function harness(mode = 'demo') {
  let stored
  let now = 1000000
  const ids = Object.fromEntries(tags.map(tag => ['NODEID_' + tag, 'ns=2;s=DB_Flotacion.' + tag]))
  function send(topic, payload) {
    const sandbox = {
      msg: { topic, payload },
      flow: { get: () => stored, set: (_, value) => { stored = value } },
      env: { get: name => name === 'CELDA_MODE' ? mode : ids[name] },
      node: { status: () => {} },
      Date: class extends Date { static now () { return now } }
    }
    const result = vm.runInNewContext(`(function(){${code}\n})()`, sandbox)
    return result
  }
  return { send, advance: ms => { now += ms }, get state () { return stored } }
}

test('las diez variables se muestran y los controles respetan 0–100 %', () => {
  const h = harness()
  let [view] = h.send('tick')
  assert.deepEqual(Object.keys(view.payload.values), tags)
  assert.equal(view.payload.online, true)
  h.send('command', { tag: 'Caudal_Aire', value: 100 })
  assert.equal(h.state.values.Caudal_Aire, 100)
  h.send('command', { tag: 'Dosificacion_Reactivo', value: 0 })
  assert.equal(h.state.values.Dosificacion_Reactivo, 0)
  h.send('command', { tag: 'Caudal_Aire', value: 101 })
  assert.equal(h.state.values.Caudal_Aire, 100)
  h.send('command', { tag: 'Nivel_Pulpa', value: 2 })
  assert.notEqual(h.state.values.Nivel_Pulpa, 2)
  h.send('command', { tag: 'Agitador_ON', value: true })
  assert.equal(h.state.values.Agitador_ON, true)
})

test('arranque y parada emiten un pulso que se restablece', () => {
  const h = harness()
  h.send('tick')
  let [view, write, reset] = h.send('command', { tag: 'Orden_Star', value: true })
  assert.equal(view.payload.values.Proceso_Activo, true)
  assert.equal(write, null)
  assert.equal(reset.topic, 'pulse-reset')
  h.advance(500)
  h.send(reset.topic, reset.payload)
  assert.equal(h.state.values.Orden_Star, false)
  ;[view, write, reset] = h.send('command', { tag: 'Orden_Stop', value: true })
  assert.equal(view.payload.values.Proceso_Activo, false)
  assert.equal(reset.topic, 'pulse-reset')
})

test('OPC exige diez lecturas vigentes y confirma por lectura posterior', () => {
  const h = harness('opc')
  let [view, write] = h.send('tick')
  assert.equal(view.payload.online, false)
  ;[view, write] = h.send('command', { tag: 'Caudal_Aire', value: 30 })
  assert.equal(write, null)
  for (const tag of tags) {
    const value = ['Agitador_ON', 'Alarma_Nivel', 'Simulacion_Activa', 'Orden_Star', 'Orden_Stop', 'Proceso_Activo'].includes(tag) ? false : 20
    h.send('opc-read', { tag, value })
  }
  ;[view, write] = h.send('command', { tag: 'Caudal_Aire', value: 30 })
  assert.equal(view.payload.online, true)
  assert.equal(write.topic, 'ns=2;s=DB_Flotacion.Caudal_Aire;datatype=Float')
  assert.equal(h.state.feedback.Caudal_Aire.kind, 'pending')
  h.send('opc-read', { tag: 'Caudal_Aire', value: 30 })
  assert.equal(h.state.feedback.Caudal_Aire.kind, 'ok')
  h.advance(6001)
  ;[view, write] = h.send('tick')
  assert.equal(view.payload.online, false)
  ;[view, write] = h.send('command', { tag: 'Agitador_ON', value: true })
  assert.equal(write, null)
})

test('orden OPC de arranque se confirma con Proceso_Activo y no con el eco de Orden_Star', () => {
  const h = harness('opc')
  for (const tag of tags) {
    const value = ['Agitador_ON', 'Alarma_Nivel', 'Simulacion_Activa', 'Orden_Star', 'Orden_Stop', 'Proceso_Activo'].includes(tag) ? false : 20
    h.send('opc-read', { tag, value })
  }
  let [, write, reset] = h.send('command', { tag: 'Orden_Star', value: true })
  assert.equal(write.payload, true)
  assert.equal(write.topic, 'ns=2;s=DB_Flotacion.Orden_Star;datatype=Boolean')
  assert.equal(h.state.feedback.Orden_Star.kind, 'pending')
  h.advance(500)
  ;[, write] = h.send(reset.topic, reset.payload)
  assert.equal(write.payload, false)
  h.send('opc-read', { tag: 'Proceso_Activo', value: true })
  assert.equal(h.state.feedback.Orden_Star.kind, 'ok')
})

test('variantes importables y clientes OPC desactivados solo en la demo local', () => {
  for (const name of ['flows.json', 'flows-opc-demo.json', 'flows-plc.json']) {
    const nodes = JSON.parse(readFileSync(join(root, name), 'utf8'))
    const ids = new Set(nodes.map(node => node.id))
    assert.equal(ids.size, nodes.length)
    const clients = nodes.filter(node => node.type === 'OpcUa-Client')
    assert.equal(clients.length, 2)
    assert.equal(clients.every(node => node.d === (name === 'flows.json')), true)
    assert.equal(nodes.some(node => node.type === 'ui-template'), true)
    for (const node of nodes) {
      for (const outputs of node.wires || []) {
        for (const target of outputs) assert.ok(ids.has(target), `${name}: referencia ${target} desconocida`)
      }
    }
  }
})
