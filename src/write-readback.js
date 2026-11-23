const code = msg.statusCode
if (code && (String(code).startsWith('Bad') || (typeof code.value === 'number' && (code.value >>> 31) === 1))) {
  return [null, { topic: 'opc-error', payload: 'Escritura OPC UA rechazada: ' + String(msg.tag || '') }]
}
const tag = msg.tag
if (!tag) return null
const readTag = tag === 'Orden_Star' || tag === 'Orden_Stop' ? 'Proceso_Activo' : tag
const nodeId = env.get('NODEID_' + readTag)
if (!nodeId) return null
return [{ topic: nodeId, tag: readTag }, null]
