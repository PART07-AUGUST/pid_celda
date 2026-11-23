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

msg.statusCode = 200
msg.payload = { commands: flow.get('edgeCommands') || [] }
return msg
