if (env.get('CELDA_MODE') !== 'opc') return null
const tags = [
  'Nivel_Pulpa', 'Caudal_Aire', 'Dosificacion_Reactivo', 'Agitador_ON',
  'Recuperacion_Estimada', 'Alarma_Nivel', 'Simulacion_Activa',
  'Orden_Star', 'Orden_Stop', 'Proceso_Activo'
]
const reads = []
for (const tag of tags) {
  const nodeId = env.get('NODEID_' + tag)
  if (nodeId) reads.push({ topic: nodeId, tag })
}
return [reads]
