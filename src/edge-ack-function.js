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

const ack = msg.payload || {}
if (typeof ack.id !== 'string' || typeof ack.ok !== 'boolean' || typeof ack.tag !== 'string') {
  msg.statusCode = 400
  msg.payload = { ok: false, error: 'ACK inválido: se requieren id, tag y ok.' }
  return msg
}

const queue = flow.get('edgeCommands') || []
flow.set('edgeCommands', queue.filter(command => command.id !== ack.id))
flow.set('edgeAck', {
  id: ack.id,
  tag: ack.tag,
  ok: ack.ok,
  value: ack.value,
  error: typeof ack.error === 'string' ? ack.error.slice(0, 240) : '',
  receivedAt: Date.now()
})

msg.statusCode = 200
msg.payload = { ok: true }
return msg
