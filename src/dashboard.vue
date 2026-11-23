<template>
  <main class="pid-dashboard">
    <header class="topbar">
      <div>
        <div class="eyebrow">CONTROL DE PROCESOS · FLOTACIÓN</div>
        <h1>Control PID de nivel</h1>
        <p>SP_Nivel → controlador PID → Salida_PID → nivel de pulpa</p>
      </div>
      <div class="mode-pill" :class="modeClass"><span></span><div><strong>{{ modeLabel }}</strong><small>{{ connectionLabel }}</small></div></div>
    </header>

    <div class="notice"><span class="notice-mark">i</span><span>{{ state.note || 'Esperando el primer ciclo PID.' }}</span></div>

    <section class="readings" aria-label="Variables principales del PID">
      <article class="read-card setpoint"><div class="card-label">CONSIGNA <code>SP_Nivel</code></div><div class="reading">{{ fmt(tagValue('SP_Nivel')) }}<small>%</small></div><div class="meter"><i :style="{width: pct(tagValue('SP_Nivel')) + '%'}"></i></div></article>
      <article class="read-card process"><div class="card-label">NIVEL MEDIDO <code>PV_Nivel</code></div><div class="reading">{{ fmt(tagValue('PV_Nivel')) }}<small>%</small></div><div class="meter"><i :style="{width: pct(tagValue('PV_Nivel')) + '%'}"></i></div></article>
      <article class="read-card error"><div class="card-label">DIFERENCIA DE NIVEL <code>Diferencia_Nivel</code></div><div class="reading">{{ signed(tagValue('Diferencia_Nivel')) }}<small>%</small></div><div class="read-hint">Error calculado: SP − PV</div></article>
      <article class="read-card output"><div class="card-label">SALIDA DE CONTROL <code>Salida_PID</code></div><div class="reading">{{ fmt(tagValue('Salida_PID')) }}<small>%</small></div><div class="meter"><i :style="{width: pct(tagValue('Salida_PID')) + '%'}"></i></div></article>
      <article class="read-card change"><div class="card-label">CAMBIO DEL NIVEL <code>Cambio_Nivel</code></div><div class="reading">{{ signed(tagValue('Cambio_Nivel')) }}<small>%/ciclo</small></div><div class="read-hint">Variación del nivel en el último ciclo</div></article>
      <article class="read-card pid-state" :class="tagValue('PID_Habilitado') ? 'pid-on' : 'pid-off'"><div class="card-label">ESTADO DEL PID <code>PID_Habilitado</code></div><div class="reading state-reading">{{ tagValue('PID_Habilitado') ? 'ACTIVO' : 'DETENIDO' }}</div><div class="read-hint">{{ tagValue('PID_Habilitado') ? 'Cálculo cada segundo' : 'Salida retenida' }}</div></article>
      <article class="read-card process-state" :class="tagValue('Proceso_Activo') ? 'process-on' : 'process-off'"><div class="card-label">PROCESO <code>Proceso_Activo</code></div><div class="reading state-reading">{{ tagValue('Proceso_Activo') === undefined ? '—' : (tagValue('Proceso_Activo') ? 'ACTIVO' : 'DETENIDO') }}</div><div class="read-hint">Estado reportado por el PLC</div></article>
    </section>

    <section class="main-grid">
      <article class="panel trend-panel">
        <div class="panel-title"><div><div class="eyebrow">RESPUESTA DEL LAZO</div><h2>Consigna y nivel</h2></div><span class="live"><i></i>1 s</span></div>
        <div class="chart-wrap">
          <div class="axis"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
          <svg class="chart" viewBox="0 0 600 220" preserveAspectRatio="none" role="img" aria-label="Tendencia de consigna, nivel medido y salida PID">
            <line v-for="y in [10,60,110,160,210]" :key="'g'+y" x1="0" :y1="y" x2="600" :y2="y" class="gridline" />
            <polyline :points="line('sp')" class="line-sp" />
            <polyline :points="line('pv')" class="line-pv" />
            <polyline :points="line('output')" class="line-out" />
          </svg>
        </div>
        <div class="legend"><span><i class="legend-sp"></i>Consigna SP</span><span><i class="legend-pv"></i>Nivel PV</span><span><i class="legend-out"></i>Salida PID</span></div>
        <div class="chart-foot">Última actualización: {{ time(state.updatedAt) }} <span>·</span> Historial de los últimos 90 ciclos</div>
      </article>

      <article class="panel controller-panel">
        <div class="panel-title"><div><div class="eyebrow">AJUSTE DEL CONTROLADOR</div><h2>Parámetros PID</h2></div><span class="state-badge" :class="tagValue('PID_Habilitado') ? 'enabled' : 'disabled'">{{ tagValue('PID_Habilitado') ? 'ACTIVO' : 'DETENIDO' }}</span></div>
        <div class="param-list">
          <div v-for="item in parameters" :key="item.tag" class="param-row">
            <label :for="'param-'+item.tag"><strong>{{ item.label }}</strong><code>{{ item.tag }}</code></label>
            <div class="param-control"><input :id="'param-'+item.tag" type="number" min="0" max="100" step="0.1" v-model="drafts[item.tag]" :disabled="!canControl" @focus="editing[item.tag] = true" @blur="editing[item.tag] = false" @keyup.enter="apply(item.tag)" /><button :disabled="!canControl" @click="apply(item.tag)">Aplicar</button></div>
          </div>
        </div>
        <button class="enable-button" :class="tagValue('PID_Habilitado') ? 'stop' : 'start'" :disabled="!canControl" @click="togglePid">{{ tagValue('PID_Habilitado') ? '■  Deshabilitar PID' : '▶  Habilitar PID' }}</button>
        <div v-if="state.mode === 'opcua'" class="process-actions">
          <button class="process-start" :disabled="!canControl" @click="pulse('Orden_Star')">▶  Arrancar proceso</button>
          <button class="process-stop" :disabled="!canControl" @click="pulse('Orden_Stop')">■  Detener proceso</button>
        </div>
        <p class="controller-note">{{ state.mode === 'opcua' ? 'Los mandos esperan confirmación de lectura del PLC.' : 'La salida queda retenida al deshabilitar. La planta simulada responde con retardo.' }}</p>
      </article>
    </section>

    <section v-if="state.mode !== 'opcua'" class="assumptions"><span>MODELO DE DEMOSTRACIÓN</span><p>Se asume que SP y PV están en porcentaje (0–100), y que una salida mayor aumenta el nivel. Ajusta el sentido, escalamiento y límites con el modelo real antes de conectar un actuador.</p></section>
    <footer>Node-RED · {{ state.mode === 'opcua' ? 'Tags PLC recibidos por el gateway OPC UA' : 'PID discreto y planta didáctica · Datos simulados' }}</footer>
  </main>
</template>

<script>
export default {
  data () {
    return {
      drafts: { SP_Nivel: 60, Kp: 2, Ki: 0.1, Kd: 0 },
      editing: {},
      parameters: [
        { tag: 'SP_Nivel', label: 'Consigna' },
        { tag: 'Kp', label: 'Ganancia proporcional' },
        { tag: 'Ki', label: 'Ganancia integral' },
        { tag: 'Kd', label: 'Ganancia derivativa' }
      ]
    }
  },
  computed: {
    state () { return this.msg?.payload || { mode: 'simulation', values: {}, history: [], online: false } },
    modeClass () {
      if (this.state.mode !== 'opcua') return 'simulation'
      return this.state.online ? 'online' : 'offline'
    },
    modeLabel () {
      if (this.state.mode !== 'opcua') return 'SIMULACIÓN'
      return this.state.online ? 'OPC UA CONECTADO' : 'OPC UA SIN DATOS'
    },
    connectionLabel () {
      if (this.state.mode !== 'opcua') return 'Valores de prueba locales'
      return this.state.online ? 'Gateway y PLC respondiendo' : 'Esperando datos del gateway'
    },
    canControl () { return this.state.mode !== 'opcua' || this.state.online === true }
  },
  watch: {
    msg: {
      immediate: true,
      handler () {
        for (const tag of ['SP_Nivel', 'Kp', 'Ki', 'Kd']) {
          if (!this.editing[tag] && typeof this.state.values?.[tag] === 'number') this.drafts[tag] = Number(this.state.values[tag].toFixed(2))
        }
      }
    }
  },
  methods: {
    tagValue (tag) { return this.state.values?.[tag] },
    fmt (value) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—' },
    signed (value) { return typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toFixed(1)}` : '—' },
    pct (value) { return typeof value === 'number' ? Math.min(100, Math.max(0, value)) : 0 },
    time (value) { return value ? new Date(value).toLocaleTimeString('es-PE') : '—' },
    line (key) {
      const points = this.state.history || []
      if (!points.length) return ''
      const start = points[0].t
      const span = Math.max(1, points[points.length - 1].t - start)
      return points.map(p => `${((p.t - start) / span * 600).toFixed(1)},${(210 - this.pct(p[key]) * 2).toFixed(1)}`).join(' ')
    },
    apply (tag) {
      if (!this.canControl) return
      const value = Number(this.drafts[tag])
      if (!Number.isFinite(value) || value < 0 || value > 100 || this.drafts[tag] === '') return
      this.editing[tag] = false
      this.send({ topic: 'command', payload: { tag, value } })
    },
    togglePid () {
      if (!this.canControl) return
      this.send({ topic: 'command', payload: { tag: 'PID_Habilitado', value: !this.tagValue('PID_Habilitado') } })
    },
    pulse (tag) {
      if (!this.canControl) return
      this.send({ topic: 'command', payload: { tag, value: true } })
    }
  }
}
</script>

<style>
.pid-dashboard{font-family:Inter,Segoe UI,Arial,sans-serif;background:#08131e;color:#eaf2f7;min-height:100vh;max-width:1600px;margin:auto;padding:30px;box-sizing:border-box}.pid-dashboard *{box-sizing:border-box}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.eyebrow{color:#6e9db4;font-size:10px;font-weight:800;letter-spacing:2px}.topbar h1{font-size:34px;letter-spacing:-.7px;margin:7px 0 5px;color:#f4f8fb}.topbar p{margin:0;color:#839baa;font-size:13px}.mode-pill{display:flex;align-items:center;gap:11px;padding:12px 16px;border:1px solid #695d39;border-radius:12px;background:#292719;min-width:205px}.mode-pill>span{width:10px;height:10px;border-radius:50%;background:#f1bd58;box-shadow:0 0 0 5px #f1bd581a}.mode-pill strong,.mode-pill small{display:block}.mode-pill strong{font-size:11px;letter-spacing:1px;color:#f4ce7c}.mode-pill small{font-size:11px;color:#a99870;margin-top:3px}.notice{display:flex;gap:10px;align-items:center;color:#acc8d6;background:#102332;border:1px solid #233d4e;border-radius:9px;padding:10px 13px;font-size:12px;margin-bottom:16px}.notice-mark{display:grid;place-items:center;width:17px;height:17px;border:1px solid #52809a;border-radius:50%;font-weight:800;font-size:11px;flex:none}.readings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.read-card,.panel{background:#111f2c;border:1px solid #263b4b;border-radius:14px;box-shadow:0 12px 28px #0002}.read-card{padding:17px 18px}.card-label{display:flex;justify-content:space-between;gap:7px;color:#a9bdc8;font-size:11px;font-weight:750;letter-spacing:.45px}.card-label code,.param-row code{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;color:#6d91a4}.reading{font-size:37px;line-height:1.2;letter-spacing:-1.5px;font-weight:750;margin:13px 0 11px}.reading small{font-size:15px;color:#718f9f;margin-left:5px;letter-spacing:0}.meter{height:4px;background:#2a4050;border-radius:8px;overflow:hidden}.meter i{height:100%;display:block;border-radius:8px;background:#50c7df}.process .meter i{background:#71d5a1}.output .meter i{background:#ffbd6c}.read-hint{font-size:10px;color:#738b9a;margin-top:13px}.error .reading{color:#ffb470}.change .reading{color:#73cce5}.pid-state .reading{font-size:23px;letter-spacing:1px;color:#aabac5}.pid-state .reading:has(+ .read-hint){color:#aabac5}.main-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(310px,1fr);gap:14px;margin-top:14px}.panel{padding:20px}.panel-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.panel-title h2{font-size:18px;margin:4px 0 0;color:#eef5f9}.live{color:#6f94a7;font:10px ui-monospace,Consolas,monospace}.live i{display:inline-block;background:#6bcf99;width:7px;height:7px;border-radius:50%;margin-right:6px}.chart-wrap{height:228px;display:flex;gap:10px}.axis{height:100%;display:flex;flex-direction:column;justify-content:space-between;color:#638094;font:10px ui-monospace,Consolas,monospace;padding:1px 0 10px}.chart{width:100%;height:100%;overflow:visible}.gridline{stroke:#263b4b;stroke-width:1;vector-effect:non-scaling-stroke}.chart polyline{fill:none;stroke-width:2.1;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}.line-sp{stroke:#ffbd6c;stroke-dasharray:5 4}.line-pv{stroke:#53c8e8}.line-out{stroke:#82d7a8;opacity:.8}.legend{display:flex;gap:18px;justify-content:center;color:#8ca6b5;font-size:10px;margin:10px 0}.legend span{display:flex;align-items:center;gap:6px}.legend i{width:14px;height:3px;border-radius:3px;background:#53c8e8}.legend-sp{background:#ffbd6c!important}.legend-out{background:#82d7a8!important}.chart-foot{text-align:right;color:#617d90;font-size:10px}.chart-foot span{padding:0 5px}.state-badge{font-size:9px;font-weight:850;letter-spacing:1px;padding:6px 9px;border-radius:20px}.state-badge.enabled{color:#72d9a5;background:#17382e;border:1px solid #2e7259}.state-badge.disabled{color:#a9b6bf;background:#263541;border:1px solid #3a4d5a}.param-list{margin:6px 0 16px}.param-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #263947}.param-row label strong,.param-row label code{display:block}.param-row label strong{font-size:12px}.param-row label code{margin-top:3px}.param-control{display:flex;align-items:center;gap:7px}.param-control input{width:76px;background:#091722;border:1px solid #385367;border-radius:7px;color:#edf5fa;padding:8px;font:12px ui-monospace,Consolas,monospace}.param-control button{background:#253d4e;border:1px solid #39576a;color:#b8d8e7;border-radius:7px;padding:8px 10px;font-size:10px;font-weight:750;cursor:pointer}.enable-button{width:100%;border:0;border-radius:8px;padding:11px;font-size:12px;font-weight:850;letter-spacing:.3px;cursor:pointer}.enable-button.start{background:#51cd97;color:#092619}.enable-button.stop{background:#e78a7e;color:#321311}.controller-note{color:#718b9b;font-size:10px;line-height:1.5;margin:10px 0 0}.assumptions{margin-top:14px;border:1px solid #4b4630;background:#211f18;border-radius:10px;padding:12px 14px}.assumptions span{color:#d6b867;font-size:9px;font-weight:850;letter-spacing:1.5px}.assumptions p{margin:5px 0 0;color:#b8aa82;font-size:11px;line-height:1.5}.pid-dashboard footer{color:#5c778a;font-size:10px;text-align:center;padding:17px 0 0}@media(max-width:980px){.readings{grid-template-columns:repeat(2,minmax(0,1fr))}.main-grid{grid-template-columns:1fr}}@media(max-width:600px){.pid-dashboard{padding:16px}.topbar{align-items:flex-start;flex-direction:column}.topbar h1{font-size:28px}.mode-pill{width:100%}.readings{grid-template-columns:1fr 1fr}.read-card{padding:13px}.reading{font-size:30px}.card-label{font-size:9px}.panel{padding:15px}.chart-wrap{height:190px}.param-control input{width:65px}}
.pid-state.pid-on .reading{color:#72d9a5}.pid-state.pid-off .reading{color:#aabac5}
.mode-pill.online{background:#14271f;border-color:#2e7259}.mode-pill.online>span{background:#70d9a4;box-shadow:0 0 0 5px #70d9a41a}.mode-pill.online strong{color:#72d9a5}.mode-pill.offline{background:#2c1d1c;border-color:#70413d}.mode-pill.offline>span{background:#e78a7e;box-shadow:0 0 0 5px #e78a7e1a}.mode-pill.offline strong{color:#f0a097}.process-state.process-on .reading{color:#72d9a5}.process-state.process-off .reading{color:#aabac5}.process-actions{display:flex;gap:8px;margin-top:10px}.process-actions button{flex:1;border:1px solid #385367;border-radius:8px;padding:9px;color:#dbe9ef;background:#1b3241;font-size:10px;font-weight:800;cursor:pointer}.process-actions .process-start{background:#18392d;border-color:#2e7259;color:#80deb0}.process-actions .process-stop{background:#3b2422;border-color:#70413d;color:#f0a097}.process-actions button:disabled,.param-control button:disabled,.param-control input:disabled,.enable-button:disabled{opacity:.45;cursor:not-allowed}
</style>
