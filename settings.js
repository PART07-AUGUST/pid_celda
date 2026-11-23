const path = require('node:path')

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
  exportGlobalContextKeys: false,
  nodesDir: path.join(__dirname, 'nodes')
}
