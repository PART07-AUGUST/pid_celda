if (!msg.error) return null
const detail = typeof msg.error === 'string' ? msg.error : msg.error.message || String(msg.error)
return { topic: 'opc-error', payload: detail }
