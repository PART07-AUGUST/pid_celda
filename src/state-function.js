const now = Date.now()
const limits = { SP_Nivel: [0, 100], Kp: [0, 100], Ki: [0, 100], Kd: [0, 100] }
let state = flow.get('pidState')

if (!state) {
  state = {
    values: {
      SP_Nivel: 60,
      PV_Nivel: 50,
      Salida_PID: 50,
      Kp: 2,
      Ki: 0.1,
      Kd: 0,
      PID_Habilitado: false
    },
    error: 10,
    note: 'Simulación local lista. No hay conexión con el PLC.',
    history: [],
    integral: 0,
    previousPV: 50,
    previousTick: now,
    lastSeen: now
  }
}

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const v = state.values

if (msg.topic === 'command') {
  const { tag, value } = msg.payload || {}
  if (tag === 'PID_Habilitado' && typeof value === 'boolean') {
    if (value && !v.PID_Habilitado) {
      state.integral = 0
      state.previousPV = v.PV_Nivel
      state.previousTick = now
    }
    v.PID_Habilitado = value
    state.note = value ? 'PID habilitado sobre la planta simulada.' : 'PID deshabilitado; la salida queda retenida en simulación.'
  } else if (Object.prototype.hasOwnProperty.call(limits, tag)) {
    const [min, max] = limits[tag]
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
  const dt = clamp((now - state.previousTick) / 1000, 0.1, 2)
  state.previousTick = now

  if (v.PID_Habilitado) {
    const error = v.SP_Nivel - v.PV_Nivel
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

  // Planta de demostración: una salida mayor eleva el nivel, con retardo de primer orden.
  const disturbance = 1.5 * Math.sin(now / 18000)
  const target = clamp(v.Salida_PID + disturbance)
  const timeConstant = 18
  v.PV_Nivel = clamp(v.PV_Nivel + (target - v.PV_Nivel) * Math.min(1, dt / timeConstant))
  state.error = v.SP_Nivel - v.PV_Nivel
  state.lastSeen = now
  state.history.push({ t: now, sp: v.SP_Nivel, pv: v.PV_Nivel, output: v.Salida_PID })
  if (state.history.length > 90) state.history.shift()
}

flow.set('pidState', state)
node.status({
  fill: v.PID_Habilitado ? 'green' : 'grey',
  shape: 'dot',
  text: v.PID_Habilitado ? `PID activo · SP ${v.SP_Nivel.toFixed(1)} · PV ${v.PV_Nivel.toFixed(1)}` : 'simulación PID en espera'
})
return { payload: {
  mode: 'simulation',
  online: true,
  values: v,
  error: state.error,
  history: state.history,
  note: state.note,
  updatedAt: now,
  lastSeen: state.lastSeen
} }
