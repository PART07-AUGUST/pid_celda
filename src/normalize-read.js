const tags = [
  'Nivel_Pulpa', 'Caudal_Aire', 'Dosificacion_Reactivo', 'Agitador_ON',
  'Recuperacion_Estimada', 'Alarma_Nivel', 'Simulacion_Activa',
  'Orden_Star', 'Orden_Stop', 'Proceso_Activo'
]
const nodeId = String(msg.topic || '').split(';datatype=')[0]
const tag = msg.tag || tags.find(name => env.get('NODEID_' + name) === nodeId)
if (!tag || !tags.includes(tag)) return null
const code = msg.statusCode
if (code && (String(code).startsWith('Bad') || (typeof code.value === 'number' && (code.value >>> 31) === 1))) {
  return { topic: 'opc-error', payload: 'Lectura OPC UA fallida: ' + tag }
}
let value = msg.payload
if (value && typeof value === 'object' && 'value' in value) value = value.value
if (['Agitador_ON', 'Alarma_Nivel', 'Simulacion_Activa', 'Orden_Star', 'Orden_Stop', 'Proceso_Activo'].includes(tag)) {
  if (typeof value !== 'boolean') return { topic: 'opc-error', payload: 'Booleano inválido: ' + tag }
} else {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { topic: 'opc-error', payload: 'Número inválido: ' + tag }
}
return { topic: 'opc-read', payload: { tag, value } }
