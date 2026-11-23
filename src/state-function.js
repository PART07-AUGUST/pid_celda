const tags = [
  'Nivel_Pulpa', 'Caudal_Aire', 'Dosificacion_Reactivo', 'Agitador_ON',
  'Recuperacion_Estimada', 'Alarma_Nivel', 'Simulacion_Activa',
  'Orden_Star', 'Orden_Stop', 'Proceso_Activo'
]
const editable = ['Caudal_Aire', 'Dosificacion_Reactivo', 'Agitador_ON']
const pulseTags = ['Orden_Star', 'Orden_Stop']
const numeric = ['Nivel_Pulpa', 'Caudal_Aire', 'Dosificacion_Reactivo', 'Recuperacion_Estimada']
const mode = env.get('CELDA_MODE') === 'opc' ? 'opc' : 'demo'
const now = Date.now()
let state = flow.get('celdaState')
if (!state || state.mode !== mode) {
  state = {
    mode,
    values: {
      Nivel_Pulpa: 50,
      Caudal_Aire: 20,
      Dosificacion_Reactivo: 5,
      Agitador_ON: false,
      Recuperacion_Estimada: 0,
      Alarma_Nivel: false,
      Simulacion_Activa: mode === 'demo',
      Orden_Star: false,
      Orden_Stop: false,
      Proceso_Activo: false
    },
    lastSeen: {},
    history: Object.fromEntries(numeric.map(tag => [tag, []])),
    pending: {},
    feedback: {},
    note: mode === 'demo' ? 'Datos simulados; no hay conexión al PLC.' : 'Esperando lecturas OPC UA.'
  }
}

function validValue(tag, value) {
  if (numeric.includes(tag)) return typeof value === 'number' && Number.isFinite(value)
  return typeof value === 'boolean'
}
function sameValue(a, b) {
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.05 : a === b
}
function fresh() {
  return tags.every(tag => now - (state.lastSeen[tag] || 0) <= 6000)
}
function clamp(value) { return Math.max(0, Math.min(100, value)) }

let write = null
let resetPulse = null
if (msg.topic === 'tick') {
  if (mode === 'demo') {
    const v = state.values
    v.Nivel_Pulpa = clamp(v.Nivel_Pulpa + Math.sin(now / 12000) * 0.36 + (v.Caudal_Aire - 20) * 0.002)
    v.Recuperacion_Estimada = clamp(35 + v.Caudal_Aire * 0.32 + v.Dosificacion_Reactivo * 0.6 + (v.Agitador_ON ? 8 : 0) - Math.abs(v.Nivel_Pulpa - 50) * 0.2)
    v.Alarma_Nivel = v.Nivel_Pulpa < 20 || v.Nivel_Pulpa > 80
    v.Simulacion_Activa = true
    for (const tag of tags) state.lastSeen[tag] = now
  }
  for (const tag of numeric) {
    if (mode === 'demo' || now - (state.lastSeen[tag] || 0) <= 6000) {
      state.history[tag].push({ t: now, v: state.values[tag] })
      if (state.history[tag].length > 60) state.history[tag].shift()
    }
  }
} else if (msg.topic === 'opc-read' && mode === 'opc') {
  const { tag, value } = msg.payload || {}
  if (tags.includes(tag) && validValue(tag, value)) {
    state.values[tag] = value
    state.lastSeen[tag] = now
    if (state.pending[tag] && sameValue(value, state.pending[tag].value)) {
      delete state.pending[tag]
      state.feedback[tag] = { kind: 'ok', text: 'Confirmado por lectura del PLC', at: now }
    }
    if (tag === 'Proceso_Activo') {
      for (const pulseTag of pulseTags) {
        const pending = state.pending[pulseTag]
        if (pending && now >= pending.at && value === pending.expectedProcessState) {
          delete state.pending[pulseTag]
          state.feedback[pulseTag] = { kind: 'ok', text: 'Confirmado por Proceso_Activo', at: now }
        }
      }
    }
  }
} else if (msg.topic === 'opc-error' && mode === 'opc') {
  state.lastSeen = {}
  state.note = String(msg.payload || 'Error OPC UA').slice(0, 180)
  for (const tag of Object.keys(state.pending)) {
    state.feedback[tag] = { kind: 'error', text: 'Sin confirmación: error de comunicación', at: now }
  }
  state.pending = {}
} else if (msg.topic === 'command') {
  const { tag, value } = msg.payload || {}
  if (pulseTags.includes(tag) && value === true) {
    const active = tag === 'Orden_Star'
    if (mode === 'opc' && !fresh()) {
      state.note = 'Orden rechazada: faltan lecturas vigentes del PLC.'
    } else if (state.pending.Orden_Star || state.pending.Orden_Stop) {
      state.note = 'Orden rechazada: ya hay una orden de proceso pendiente.'
    } else if (state.values.Proceso_Activo === active) {
      state.feedback[tag] = { kind: 'ok', text: active ? 'Proceso ya activo' : 'Proceso ya detenido', at: now }
    } else {
      state.pending[tag] = { expectedProcessState: active, at: now }
      state.feedback[tag] = { kind: 'pending', text: 'Esperando estado del proceso', at: now }
      state.values[tag] = true
      if (mode === 'demo') {
        state.values.Proceso_Activo = active
        delete state.pending[tag]
        state.feedback[tag] = { kind: 'ok', text: 'Confirmado en simulación', at: now }
      } else {
        const nodeId = env.get('NODEID_' + tag)
        if (!nodeId) {
          delete state.pending[tag]
          state.feedback[tag] = { kind: 'error', text: 'Falta NodeId', at: now }
        } else {
          write = { topic: nodeId + ';datatype=Boolean', payload: true, tag }
        }
      }
      resetPulse = { topic: 'pulse-reset', payload: { tag } }
    }
  } else if (!editable.includes(tag) || !validValue(tag, value) ||
      (tag !== 'Agitador_ON' && (value < 0 || value > 100))) {
    state.note = 'Mando rechazado: señal o valor no permitido.'
  } else if (mode === 'opc' && !fresh()) {
    state.note = 'Mando rechazado: faltan lecturas vigentes del PLC.'
  } else if (state.pending[tag]) {
    state.note = 'Mando rechazado: ya hay una escritura pendiente para esta señal.'
  } else if (mode === 'demo') {
    state.values[tag] = value
    state.feedback[tag] = { kind: 'ok', text: 'Confirmado en simulación', at: now }
    state.note = 'Mando aplicado únicamente en la simulación.'
  } else {
    const nodeId = env.get('NODEID_' + tag)
    if (!nodeId) {
      state.note = 'Mando rechazado: falta el NodeId de ' + tag + '.'
    } else {
      state.pending[tag] = { value, at: now }
      state.feedback[tag] = { kind: 'pending', text: 'Esperando lectura de confirmación', at: now }
      state.note = 'Escritura solicitada; esperando valor leído del PLC.'
      write = { topic: nodeId + ';datatype=' + (tag === 'Agitador_ON' ? 'Boolean' : 'Float'), payload: value, tag }
    }
  }
} else if (msg.topic === 'pulse-reset') {
  const tag = msg.payload?.tag
  if (pulseTags.includes(tag)) {
    state.values[tag] = false
    if (mode === 'opc') {
      const nodeId = env.get('NODEID_' + tag)
      if (nodeId) write = { topic: nodeId + ';datatype=Boolean', payload: false, tag }
    }
  }
}

for (const [tag, pending] of Object.entries(state.pending)) {
  if (now - pending.at > 8000) {
    delete state.pending[tag]
    state.feedback[tag] = { kind: 'error', text: 'Sin confirmación del PLC (8 s)', at: now }
  }
}

const online = mode === 'demo' || fresh()
if (mode === 'opc' && !online && msg.topic !== 'opc-error') {
  state.note = 'Lecturas OPC UA incompletas o antiguas; mandos deshabilitados.'
}
state.mode = mode
flow.set('celdaState', state)
node.status({ fill: online ? 'green' : 'red', shape: 'dot', text: mode === 'demo' ? 'simulación' : online ? 'PLC conectado' : 'PLC sin datos' })
return [{ payload: {
  mode, online, values: state.values, history: state.history,
  pending: state.pending, feedback: state.feedback, note: state.note,
  updatedAt: now, lastSeen: state.lastSeen
} }, write, resetPulse]
