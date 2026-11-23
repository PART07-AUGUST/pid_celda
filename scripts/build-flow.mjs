import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = name => readFileSync(join(root, 'src', name), 'utf8').trim()
const id = name => createHash('sha1').update('pid-celda:' + name).digest('hex').slice(0, 16)
const tab = id('tab')
const base = id('ui-base')
const page = id('ui-page')
const group = id('ui-group')
const theme = id('ui-theme')
const state = id('state')
const ui = id('ui-template')
const nodes = []

nodes.push({
  id: tab, type: 'tab', label: 'PID · Celda de flotación', disabled: false,
  info: 'Dashboard PID en modo de simulación o conectado a la pasarela S7 Python mediante HTTPS.', env: []
})
nodes.push({
  id: base, type: 'ui-base', name: 'Control PID celda', path: '/dashboard',
  appIcon: '', includeClientData: true, acceptsClientConfig: [],
  showPathInSidebar: false, headerContent: 'none', navigationStyle: 'none',
  titleBarStyle: 'hidden', showReconnectNotification: true,
  showDisconnectNotification: true, allowInstall: false
})
nodes.push({
  id: theme, type: 'ui-theme', name: 'Tema industrial',
  colors: { surface: '#08131e', primary: '#53c8e8', bgPage: '#08131e', groupBg: '#08131e', groupOutline: '#08131e' },
  sizes: { density: 'default', pagePadding: '0px', groupGap: '0px', groupBorderRadius: '0px', widgetGap: '0px' }
})
nodes.push({
  id: page, type: 'ui-page', name: 'Control PID', ui: base, path: '', icon: 'dashboard',
  layout: 'grid', theme, breakpoints: [
    { name: 'Default', px: 0, cols: 3 }, { name: 'Tablet', px: 576, cols: 6 },
    { name: 'Small Desktop', px: 768, cols: 9 }, { name: 'Desktop', px: 1024, cols: 12 }
  ], order: 1, className: '', visible: true, disabled: false
})
nodes.push({
  id: group, type: 'ui-group', name: 'Lazo PID', page, width: 12,
  height: 1, order: 1, showTitle: false, className: 'pid-group',
  visible: true, disabled: false, groupType: 'default'
})
nodes.push({
  id: id('tick'), type: 'inject', z: tab, name: 'Ciclo PID y planta simulada · 1 s',
  props: [{ p: 'topic', vt: 'str' }], repeat: '1', crontab: '', once: true,
  onceDelay: '0.5', topic: 'tick', payload: '', payloadType: 'date',
  x: 220, y: 150, wires: [[state]]
})
nodes.push({
  id: state, type: 'function', z: tab, name: 'PID + modelo de proceso',
  func: source('state-function.js'), outputs: 1, noerr: 0, initialize: '', finalize: '',
  libs: [], x: 510, y: 190, wires: [[ui]]
})
nodes.push({
  id: ui, type: 'ui-template', z: tab, group, page: '', ui: '', name: 'Panel PID de nivel',
  order: 1, width: 12, height: 20, head: '', format: source('dashboard.vue'),
  storeOutMessages: true, passthru: false, resendOnRefresh: true,
  templateScope: 'local', className: 'pid-dashboard-widget', x: 800, y: 190,
  wires: [[state]]
})

const addHttpEndpoint = (name, path, method, functionFile, y) => {
  const input = id(`${name}-http-in`)
  const handler = id(`${name}-handler`)
  const response = id(`${name}-http-response`)
  nodes.push({
    id: input, type: 'http in', z: tab, name, url: path, method, upload: false,
    swaggerDoc: '', x: 220, y, wires: [[handler]]
  })
  nodes.push({
    id: handler, type: 'function', z: tab, name: `${name} · validar`,
    func: source(functionFile), outputs: 1, noerr: 0, initialize: '', finalize: '',
    libs: [], x: 510, y, wires: [[response]]
  })
  nodes.push({ id: response, type: 'http response', z: tab, name: '', statusCode: '', headers: {}, x: 790, y, wires: [] })
}

addHttpEndpoint('PLC · telemetría de la pasarela', '/api/edge/telemetry', 'post', 'edge-telemetry-function.js', 340)
addHttpEndpoint('PLC · consultar mandos', '/api/edge/commands', 'get', 'edge-commands-function.js', 410)
addHttpEndpoint('PLC · confirmar escritura', '/api/edge/ack', 'post', 'edge-ack-function.js', 480)
addHttpEndpoint('Render · health check', '/api/healthz', 'get', 'health-function.js', 550)

writeFileSync(join(root, 'flows.json'), JSON.stringify(nodes, null, 2) + '\n')
console.log(`flows.json generado: ${nodes.length} nodos`)
