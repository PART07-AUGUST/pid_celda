const now = Date.now()
const configuredMode = String(env.get('PID_DATA_MODE') || 'simulation').toLowerCase()
const mode = ['plc', 'opcua'].includes(configuredMode) ? 'plc' : 'simulation'
const staleAfter = Math.max(1500, Number(env.get('EDGE_STALE_MS')) || 5000)
const numericLimits = {
  SP_Nivel: [0, 100],
  Kp: [0, 100],
  Ki: [0, 100],
  Kd: [0, 100]
}

let state = flow.get('pidState')
if (!state || state.mode !== mode) {
  state = {
    mode,
    values: mode === 'simulation' ? {
      SP_Nivel: 60,
      PV_Nivel: 50,
      Salida_PID: 50,
      Kp: 2,
      Ki: 0.1,
      Kd: 0,
      PID_Habilitado: false,
      Diferencia_Nivel: 10,
      Cambio_Nivel: 0,
      Proceso_Activo: false
    } : {},
    error: null,
    note: mode === 'simulation'
      ? 'Simulación local lista. No hay conexión con el PLC.'
      : 'Esperando datos de la pasarela Python S7.',
    online: mode === 'simulation',
    controlsEnabled: mode === 'simulation',
    history: [],
    integral: 0,
    previousPV: 50,
    previousTick: now,
    lastSeen: null,
    lastHistoryAt: null
  }
}

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const v = state.values

if (msg.topic === 'command') {
  const { tag, value } = msg.payload || {}

  if (mode === 'plc') {
    state.note = 'Conexión al PLC en solo lectura; los mandos están deshabilitados.'
  } else if (tag === 'PID_Habilitado' && typeof value === 'boolean') {
    if (value && !v.PID_Habilitado) {
      state.integral = 0
      state.previousPV = v.PV_Nivel
      state.previousTick = now
    }
    v.PID_Habilitado = value
    state.note = value ? 'PID habilitado sobre la planta simulada.' : 'PID deshabilitado; la salida queda retenida en simulación.'
  } else if (Object.prototype.hasOwnProperty.call(numericLimits, tag)) {
    const [min, max] = numericLimits[tag]
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
      state.note = `${tag} rechazado: el valor debe estar entre ${min} y ${max}.`
    } else {
      v[tag] = numeric
      state.note = `${tag} actualizado en la simulación.`
    }
  } else {
    state.note = 'Mando rechazado: variable no permitida.'
  }
}

if (msg.topic === 'tick') {
  if (mode === 'plc') {
    const telemetry = flow.get('edgeTelemetry')
    const isFresh = telemetry && telemetry.connected === true && now - telemetry.receivedAt <= staleAfter

    state.online = Boolean(isFresh)
    state.controlsEnabled = false
    if (isFresh) {
      state.values = telemetry.values || {}
      state.lastSeen = telemetry.receivedAt
      const sampleTime = Number(telemetry.sentAt) || telemetry.receivedAt
      if (sampleTime !== state.lastHistoryAt && Number.isFinite(state.values.SP_Nivel) && Number.isFinite(state.values.PV_Nivel)) {
        state.history.push({
          t: sampleTime,
          sp: state.values.SP_Nivel,
          pv: state.values.PV_Nivel,
          output: Number(state.values.Salida_PID) || 0
        })
        state.lastHistoryAt = sampleTime
        if (state.history.length > 90) state.history.shift()
      }
      state.error = typeof state.values.Diferencia_Nivel === 'number'
        ? state.values.Diferencia_Nivel
        : (Number(state.values.SP_Nivel) - Number(state.values.PV_Nivel))
      state.note = telemetry.error
        ? `Pasarela conectada con aviso: ${telemetry.error}`
        : 'PLC conectado; datos recibidos por la pasarela S7.'
    } else {
      state.note = telemetry && telemetry.error
        ? `Pasarela S7 desconectada: ${telemetry.error}`
        : 'Sin datos S7 recientes. El dashboard permanece en solo lectura.'
    }
  } else {
    const dt = clamp((now - state.previousTick) / 1000, 0.1, 2)
    state.previousTick = now

    if (v.PID_Habilitado) {
      const error = v.SP_Nivel - v.PV_Nivel
      v.Diferencia_Nivel = error
      const proportional = v.Kp * error
      const derivative = -v.Kd * (v.PV_Nivel - state.previousPV) / dt
      const candidateIntegral = state.integral + v.Ki * error * dt
      const unconstrained = 50 + proportional + candidateIntegral + derivative
      const output = clamp(unconstrained)
      const pushesFurtherIntoSaturation = (unconstrained > 100 && error > 0) || (unconstrained < 0 && error < 0)
      if (!pushesFurtherIntoSaturation) state.integral = candidateIntegral
      v.Salida_PID = output
      state.previousPV = v.PV_Nivel
    }

    // Planta didáctica de primer orden; no representa una celda validada.
    const disturbance = 1.5 * Math.sin(now / 18000)
    const target = clamp(v.Salida_PID + disturbance)
    const timeConstant = 18
    const previousPV = v.PV_Nivel
    v.PV_Nivel = clamp(v.PV_Nivel + (target - v.PV_Nivel) * Math.min(1, dt / timeConstant))
    v.Diferencia_Nivel = v.SP_Nivel - v.PV_Nivel
    v.Cambio_Nivel = v.PV_Nivel - previousPV
    state.error = v.Diferencia_Nivel
    state.lastSeen = now
    state.online = true
    state.controlsEnabled = true
    state.history.push({ t: now, sp: v.SP_Nivel, pv: v.PV_Nivel, output: v.Salida_PID })
    if (state.history.length > 90) state.history.shift()
  }
}

flow.set('pidState', state)
node.status({
  fill: state.online ? (mode === 'plc' ? 'blue' : 'green') : 'grey',
  shape: 'dot',
  text: mode === 'plc'
    ? (state.online ? 'pasarela S7 conectada · solo lectura' : 'esperando pasarela S7')
    : (v.PID_Habilitado ? `PID activo · SP ${v.SP_Nivel.toFixed(1)} · PV ${v.PV_Nivel.toFixed(1)}` : 'simulación PID en espera')
})

return { payload: {
  mode,
  online: state.online,
  controlsEnabled: state.controlsEnabled,
  values: state.values,
  error: state.error,
  history: state.history,
  note: state.note,
  updatedAt: now,
  lastSeen: state.lastSeen
} }
