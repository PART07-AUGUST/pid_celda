const path = require('node:path')
const crypto = require('node:crypto')

const dashboardUser = process.env.DASHBOARD_AUTH_USER || ''
const dashboardPassword = process.env.DASHBOARD_AUTH_PASSWORD || ''
const dashboardAuthRequired = String(process.env.PID_DATA_MODE || 'simulation').toLowerCase() === 'opcua'

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function isAuthorized(request) {
  if (!dashboardUser || !dashboardPassword) return false
  const header = request.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  let credentials
  try {
    credentials = Buffer.from(header.slice(6), 'base64').toString('utf8')
  } catch (_) {
    return false
  }
  const separator = credentials.indexOf(':')
  if (separator < 0) return false
  return safeEqual(credentials.slice(0, separator), dashboardUser) &&
    safeEqual(credentials.slice(separator + 1), dashboardPassword)
}

function dashboardAuth(request, response, next) {
  if (!dashboardAuthRequired && !dashboardUser && !dashboardPassword) return next()
  if (!dashboardUser || !dashboardPassword) {
    response.status(503).send('Configura DASHBOARD_AUTH_USER y DASHBOARD_AUTH_PASSWORD antes de habilitar OPC UA.')
    return
  }
  if (isAuthorized(request)) return next()
  response.set('WWW-Authenticate', 'Basic realm="PID celda", charset="UTF-8"')
  response.status(401).send('Autenticación requerida.')
}

function dashboardSocketAuth(socket, next) {
  if (!dashboardAuthRequired && !dashboardUser && !dashboardPassword) return next()
  if (isAuthorized(socket.request)) return next()
  next(new Error('Autenticación requerida para el Dashboard.'))
}

module.exports = {
  uiHost: process.env.NODE_RED_HOST || '0.0.0.0',
  uiPort: Number(process.env.PORT || process.env.NODE_RED_PORT || 1880),
  flowFile: 'flows.json',
  userDir: process.env.NODE_RED_USER_DIR || __dirname,
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || undefined,
  httpAdminRoot: process.env.NODE_RED_DISABLE_EDITOR === '1' ? false : '/',
  diagnostics: { enabled: false },
  logging: { console: { level: 'info', metrics: false, audit: false } },
  editorTheme: { projects: { enabled: false } },
  functionGlobalContext: {},
  functionExternalModules: false,
  contextStorage: { default: { module: 'memory' } },
  dashboard: {
    middleware: dashboardAuth,
    ioMiddleware: dashboardSocketAuth
  },
  exportGlobalContextKeys: false,
  nodesDir: path.join(__dirname, 'nodes')
}
