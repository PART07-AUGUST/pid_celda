const path = require('node:path')

if (!process.env.OPCUA_ENDPOINT && process.env.OPCUA_HOST) {
  process.env.OPCUA_ENDPOINT = `opc.tcp://${process.env.OPCUA_HOST}:4840/celda/`
}

module.exports = {
  uiHost: process.env.NODE_RED_HOST || '127.0.0.1',
  uiPort: Number(process.env.NODE_RED_PORT || process.env.PORT || 1880),
  flowFile: 'flows.json',
  userDir: process.env.NODE_RED_USER_DIR || __dirname,
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || undefined,
  httpAdminRoot: process.env.NODE_RED_DISABLE_EDITOR === '1' ? false : '/red',
  diagnostics: { enabled: false },
  logging: { console: { level: 'info', metrics: false, audit: false } },
  editorTheme: { projects: { enabled: false } },
  functionGlobalContext: {},
  functionExternalModules: false,
  contextStorage: { default: { module: 'memory' } },
  exportGlobalContextKeys: false,
  nodesDir: path.join(__dirname, 'nodes')
}
