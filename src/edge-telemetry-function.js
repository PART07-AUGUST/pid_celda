const expected = env.get('EDGE_API_TOKEN')
const authorization = msg.req && msg.req.headers ? msg.req.headers.authorization : ''
if (!expected) {
  msg.statusCode = 503
  msg.payload = { ok: false, error: 'EDGE_API_TOKEN no está configurado en Render.' }
  return msg
}
if (authorization !== `Bearer ${expected}`) {
  msg.statusCode = 401
  msg.payload = { ok: false, error: 'Token de gateway inválido.' }
  return msg
}

const body = msg.payload || {}
if (typeof body.connected !== 'boolean' || (body.values !== undefined && (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)))) {
  msg.statusCode = 400
  msg.payload = { ok: false, error: 'Se requiere connected booleano y values como objeto.' }
  return msg
}

const numericRanges = {
  Nivel_Pulpa: [0, 100], Caudal_Aire: [0, 100], Dosificacion_Reactivo: [0, 100],
  Recuperacion_Estimada: [0, 100], SP_Nivel: [0, 100], PV_Nivel: [0, 100],
  Salida_PID: [0, 100], Kp: [0, 100], Ki: [0, 100], Kd: [0, 100],
  Diferencia_Nivel: [-100, 100], Cambio_Nivel: [-100, 100]
}
const booleanTags = ['Agitador_ON', 'Alarma_Nivel', 'Simulacion_Activa', 'PID_Habilitado', 'Proceso_Activo']
const values = {}
for (const [tag, value] of Object.entries(body.values || {})) {
  if (Object.prototype.hasOwnProperty.call(numericRanges, tag)) {
    const numeric = Number(value)
    const [min, max] = numericRanges[tag]
    if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
      msg.statusCode = 400
      msg.payload = { ok: false, error: `Valor inválido para ${tag}.` }
      return msg
    }
    values[tag] = numeric
  } else if (booleanTags.includes(tag)) {
    if (typeof value !== 'boolean') {
      msg.statusCode = 400
      msg.payload = { ok: false, error: `Valor booleano inválido para ${tag}.` }
      return msg
    }
    values[tag] = value
  }
}

const receivedAt = Date.now()
const sentAt = Number(body.timestamp)
flow.set('edgeTelemetry', {
  connected: body.connected,
  values,
  sentAt: Number.isFinite(sentAt) ? sentAt : receivedAt,
  receivedAt,
  error: typeof body.error === 'string' ? body.error.slice(0, 240) : ''
})

msg.statusCode = 202
msg.payload = { ok: true, receivedAt }
return msg
