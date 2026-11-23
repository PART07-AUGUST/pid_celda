import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = name => readFileSync(join(root, 'src', name), 'utf8').trim()
const variant = (process.argv.find(arg => arg.startsWith('--variant=')) || '--variant=local').split('=')[1]
if (!['local', 'opc-demo', 'plc'].includes(variant)) throw new Error('Variante desconocida: ' + variant)
const id = name => createHash('sha1').update('celda:' + name).digest('hex').slice(0, 16)
const tab = id('tab')
const base = id('ui-base')
const page = id('ui-page')
const group = id('ui-group')
const theme = id('ui-theme')
const state = id('state')
const ui = id('ui-template')
const read = id('opc-read')
const write = id('opc-write')
const error = id('opc-error')
const nodes = []

const tags = [
  'Nivel_Pulpa', 'Caudal_Aire', 'Dosificacion_Reactivo', 'Agitador_ON',
  'Recuperacion_Estimada', 'Alarma_Nivel', 'Simulacion_Activa',
  'Orden_Star', 'Orden_Stop', 'Proceso_Activo'
]

nodes.push({
  id: tab, type: 'tab', label: 'Celda de flotación', disabled: false,
  info: 'Dashboard, demo y adaptador OPC UA. Configure las variables de entorno de esta pestaña antes de activar los nodos OPC UA.',
  env: variant === 'opc-demo'
    ? [{ name: 'CELDA_MODE', value: 'opc', type: 'str' }, ...tags.map(tag => ({ name: 'NODEID_' + tag, value: `ns=2;s=DB_Flotacion.${tag}`, type: 'str' }))]
    : variant === 'local' ? [{ name: 'CELDA_MODE', value: 'demo', type: 'str' }] : []
})
nodes.push({
  id: base, type: 'ui-base', name: 'Celda de flotación', path: '/dashboard',
  appIcon: '', includeClientData: true, acceptsClientConfig: [],
  showPathInSidebar: false, headerContent: 'none', navigationStyle: 'none',
  titleBarStyle: 'hidden', showReconnectNotification: true,
  showDisconnectNotification: true, allowInstall: false
})
nodes.push({
  id: theme, type: 'ui-theme', name: 'Tema industrial',
  colors: { surface: '#09131e', primary: '#42b9d4', bgPage: '#09131e', groupBg: '#09131e', groupOutline: '#09131e' },
  sizes: { density: 'default', pagePadding: '0px', groupGap: '0px', groupBorderRadius: '0px', widgetGap: '0px' }
})
nodes.push({
  id: page, type: 'ui-page', name: 'Celda', ui: base, path: '/celda', icon: 'home',
  layout: 'grid', theme, breakpoints: [
    { name: 'Default', px: 0, cols: 3 }, { name: 'Tablet', px: 576, cols: 6 },
    { name: 'Small Desktop', px: 768, cols: 9 }, { name: 'Desktop', px: 1024, cols: 12 }
  ], order: 1, className: '', visible: true, disabled: false
})
nodes.push({
  id: group, type: 'ui-group', name: 'Vista general', page, width: 12,
  height: 1, order: 1, showTitle: false, className: 'celda-group',
  visible: true, disabled: false, groupType: 'default'
})

function fn(key, name, file, x, y, outputs, wires) {
  nodes.push({
    id: id(key), type: 'function', z: tab, name, func: source(file),
    outputs, noerr: 0, initialize: '', finalize: '', libs: [], x, y, wires
  })
}
function inject(name, x, y, repeat, topic, target) {
  nodes.push({
    id: id(name), type: 'inject', z: tab, name, props: [{ p: 'topic', vt: 'str' }],
    repeat, crontab: '', once: true, onceDelay: 0.4, topic,
    x, y, wires: [[target]]
  })
}

nodes.push({ id: id('comment-demo'), type: 'comment', z: tab, name: '1 · Simulación y dashboard', info: 'Modo demo por defecto. No escribe al PLC.', x: 170, y: 60, wires: [] })
inject('tick', 150, 120, '2', 'tick', state)
fn('state', 'Estado y mandos', 'state-function.js', 450, 210, 3, [[ui], [write], [id('pulse-delay')]])
nodes.push({
  id: ui, type: 'ui-template', z: tab, group, page: '', ui: '', name: 'Dashboard celda',
  order: 1, width: 12, height: 20, head: '', format: source('dashboard.vue'),
  storeOutMessages: true, passthru: false, resendOnRefresh: true,
  templateScope: 'local', className: 'celda-widget', x: 770, y: 150,
  wires: [[state]]
})
nodes.push({
  id: id('pulse-delay'), type: 'delay', z: tab, name: 'Pulso 500 ms',
  pauseType: 'delay', timeout: '0.5', timeoutUnits: 'seconds', rate: '1',
  nbRateUnits: '1', rateUnits: 'second', randomFirst: '1', randomLast: '5',
  randomUnits: 'seconds', drop: false, outputs: 1, x: 770, y: 250,
  wires: [[state]]
})

nodes.push({ id: id('comment-opc'), type: 'comment', z: tab, name: '2 · OPC UA: configurar y habilitar los dos clientes', info: 'Los clientes OPC UA están desactivados para que la demo arranque sin PLC. Configure endpoint, seguridad y NodeIds; después cambie CELDA_MODE a opc y habilite los clientes.', x: 290, y: 360, wires: [] })
inject('opc-poll', 150, 420, '2', 'poll', id('prepare-reads'))
fn('prepare-reads', 'Preparar lecturas', 'prepare-reads.js', 390, 420, 1, [[read]])
nodes.push({
  id: id('opc-endpoint'), type: 'OpcUa-Endpoint', name: 'PLC S7-1200 — CONFIGURAR',
  endpoint: '${OPCUA_ENDPOINT}',
  secpol: variant === 'plc' ? 'Basic256Sha256' : 'None',
  secmode: variant === 'plc' ? 'SignAndEncrypt' : 'None',
  none: variant !== 'plc', login: false, usercert: false, usercertificate: '', userprivatekey: ''
})
function opcClient(name, action, nodeId, x, y, wires) {
  nodes.push({
    id: nodeId, type: 'OpcUa-Client', z: tab, d: variant === 'local', endpoint: id('opc-endpoint'),
    action, deadbandtype: 'a', deadbandvalue: 1, time: 10, timeUnit: 's',
    certificate: 'n', localfile: '', localkeyfile: '',
    securitymode: variant === 'plc' ? 'SignAndEncrypt' : 'None',
    securitypolicy: variant === 'plc' ? 'Basic256Sha256' : 'None',
    useTransport: false, maxChunkCount: 1,
    maxMessageSize: 8192, receiveBufferSize: 8192, sendBufferSize: 8192,
    setstatusandtime: false, keepsessionalive: true, name, x, y, wires
  })
}
opcClient('OPC UA leer — HABILITAR', 'read', read, 660, 420, [[id('normalize-read')], [error], []])
fn('normalize-read', 'Validar lectura', 'normalize-read.js', 920, 420, 1, [[state]])
opcClient('OPC UA escribir — HABILITAR', 'write', write, 930, 540, [[id('write-readback')], [error], []])
fn('write-readback', 'Releer tras escritura', 'write-readback.js', 1180, 540, 2, [[id('readback-delay')], [state]])
nodes.push({
  id: id('readback-delay'), type: 'delay', z: tab, name: 'Espera lectura 500 ms',
  pauseType: 'delay', timeout: '0.5', timeoutUnits: 'seconds', rate: '1',
  nbRateUnits: '1', rateUnits: 'second', randomFirst: '1', randomLast: '5',
  randomUnits: 'seconds', drop: false, outputs: 1, x: 1430, y: 520,
  wires: [[read]]
})
fn('opc-error', 'Error OPC UA', 'normalize-error.js', 1180, 680, 1, [[state]])
nodes.push({
  id: id('opc-catch'), type: 'catch', z: tab, name: 'Errores de clientes OPC UA',
  scope: [read, write], uncaught: false, x: 930, y: 680, wires: [[error]]
})

const output = variant === 'local' ? 'flows.json' : variant === 'opc-demo' ? 'flows-opc-demo.json' : 'flows-plc.json'
writeFileSync(join(root, output), JSON.stringify(nodes, null, 2) + '\n')
console.log(`${output} generado: ${nodes.length} nodos`)
