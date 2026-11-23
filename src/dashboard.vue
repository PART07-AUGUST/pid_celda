<template>
  <div class="flotation-dashboard">
    <header class="dash-header">
      <div>
        <div class="eyebrow">SIMATIC S7-1200 · DB_Flotacion</div>
        <h1>Celda de flotación</h1>
        <p>Supervisión del proceso y mandos disponibles</p>
      </div>
      <div class="connection" :class="state.online ? 'online' : 'offline'">
        <span class="connection-dot"></span>
        <div><strong>{{ state.mode === 'demo' ? 'DEMO ACTIVA' : state.online ? 'PLC CONECTADO' : 'SIN DATOS DEL PLC' }}</strong>
          <small>{{ state.mode === 'demo' ? 'Señales simuladas en Node-RED' : state.online ? 'Lecturas OPC UA vigentes' : 'Mandos deshabilitados' }}</small>
        </div>
      </div>
    </header>

    <div class="notice" role="status">{{ state.note || 'Esperando datos de la celda.' }}</div>

    <section class="metric-grid" aria-label="Variables de proceso">
      <article v-for="item in metrics" :key="item.tag" class="metric-card">
        <div class="metric-top"><span>{{ item.label }}</span><span class="metric-code">{{ item.code }}</span></div>
        <div class="metric-reading">{{ formatNumber(value(item.tag)) }}<span>%</span></div>
        <div class="metric-track"><div :style="{ width: percent(value(item.tag)) + '%', background: item.color }"></div></div>
        <svg class="sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="spark(item.tag)" fill="none" :stroke="item.color" stroke-width="1.8" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="metric-bottom"><span>Tendencia reciente</span><span>{{ freshLabel(item.tag) }}</span></div>
      </article>
    </section>

    <div class="lower-grid">
      <section class="panel" aria-label="Mandos de operación">
        <div class="section-heading"><div><span class="eyebrow">OPERACIÓN</span><h2>Mandos</h2></div><span class="section-hint">Cambios confirmados por lectura</span></div>
        <div v-for="item in controls" :key="item.tag" class="control-row">
          <div class="control-copy"><strong>{{ item.label }}</strong><small>{{ item.tag }} · 0–100 %</small></div>
          <div class="control-action">
            <div class="number-field"><input type="number" min="0" max="100" step="0.1" v-model="drafts[item.tag]" :disabled="!state.online || !!pending(item.tag)" @focus="editing[item.tag] = true" @blur="editing[item.tag] = false" @keyup.enter="apply(item.tag)" :aria-label="item.label" /><span>%</span></div>
            <button class="primary-btn" :disabled="!state.online || !!pending(item.tag)" @click="apply(item.tag)">Aplicar</button>
          </div>
          <div class="feedback" :class="feedback(item.tag)?.kind">{{ feedback(item.tag)?.text || 'Valor actual: ' + formatNumber(value(item.tag)) + ' %' }}</div>
        </div>
        <div class="control-row compact">
          <div class="control-copy"><strong>Agitador</strong><small>Agitador_ON · mando booleano</small></div>
          <button class="toggle-btn" :class="value('Agitador_ON') ? 'active' : ''" :disabled="!state.online || !!pending('Agitador_ON')" @click="sendCommand('Agitador_ON', !value('Agitador_ON'))">{{ value('Agitador_ON') ? 'Encendido' : 'Apagado' }}</button>
          <div class="feedback" :class="feedback('Agitador_ON')?.kind">{{ feedback('Agitador_ON')?.text || 'Estado leído del PLC' }}</div>
        </div>
        <div class="process-controls">
          <div class="control-copy"><strong>Proceso</strong><small>Órdenes de pulso de 500 ms</small></div>
          <div class="process-buttons">
            <button class="start-btn" :disabled="!state.online || !!pending('Orden_Star') || !!pending('Orden_Stop') || value('Proceso_Activo')" @click="sendCommand('Orden_Star', true)">▶ Arrancar</button>
            <button class="stop-btn" :disabled="!state.online || !!pending('Orden_Star') || !!pending('Orden_Stop') || !value('Proceso_Activo')" @click="sendCommand('Orden_Stop', true)">■ Detener</button>
          </div>
          <div class="feedback" :class="(feedback('Orden_Star') || feedback('Orden_Stop'))?.kind">{{ (feedback('Orden_Star') || feedback('Orden_Stop'))?.text || 'Se confirma con Proceso_Activo' }}</div>
        </div>
      </section>

      <section class="panel" aria-label="Estados del PLC">
        <div class="section-heading"><div><span class="eyebrow">ESTADOS</span><h2>Señales discretas</h2></div></div>
        <div v-for="item in statuses" :key="item.tag" class="status-row">
          <div><strong>{{ item.label }}</strong><small>{{ item.tag }}</small></div>
          <span class="status-pill" :class="statusClass(item.tag)"><i></i>{{ statusText(item.tag) }}</span>
        </div>
        <div class="source-box"><strong>Origen de datos</strong><p>{{ state.mode === 'demo' ? 'Simulación local de Node-RED. No se envían datos al PLC.' : 'Variables publicadas por DB_Flotacion mediante OPC UA.' }}</p></div>
      </section>
    </div>
    <footer>Última actualización: {{ timestamp(state.updatedAt) }} · El dashboard no calcula PID ni controla una válvula.</footer>
  </div>
</template>

<script>
export default {
  data () {
    return {
      drafts: { Caudal_Aire: 20, Dosificacion_Reactivo: 5 },
      editing: {},
      metrics: [
        { tag: 'Nivel_Pulpa', label: 'Nivel de pulpa', code: 'NIVEL', color: '#53c8e8' },
        { tag: 'Caudal_Aire', label: 'Caudal de aire', code: 'AIRE', color: '#9d88fa' },
        { tag: 'Dosificacion_Reactivo', label: 'Dosificación de reactivo', code: 'REACTIVO', color: '#ffbc64' },
        { tag: 'Recuperacion_Estimada', label: 'Recuperación estimada', code: 'RECUP.', color: '#75d8a2' }
      ],
      controls: [
        { tag: 'Caudal_Aire', label: 'Caudal de aire' },
        { tag: 'Dosificacion_Reactivo', label: 'Dosificación de reactivo' }
      ],
      statuses: [
        { tag: 'Proceso_Activo', label: 'Proceso activo' },
        { tag: 'Agitador_ON', label: 'Agitador' },
        { tag: 'Alarma_Nivel', label: 'Alarma de nivel' },
        { tag: 'Simulacion_Activa', label: 'Simulación en PLC' },
        { tag: 'Orden_Star', label: 'Orden de arranque' },
        { tag: 'Orden_Stop', label: 'Orden de parada' }
      ]
    }
  },
  computed: {
    state () { return this.msg?.payload || { mode: 'demo', online: false, values: {}, history: {}, feedback: {}, pending: {}, lastSeen: {} } }
  },
  watch: {
    msg: {
      immediate: true,
      handler () {
        for (const tag of ['Caudal_Aire', 'Dosificacion_Reactivo']) {
          if (!this.editing[tag] && typeof this.state.values?.[tag] === 'number') this.drafts[tag] = Number(this.state.values[tag].toFixed(1))
        }
      }
    }
  },
  methods: {
    value (tag) { return this.state.values?.[tag] },
    pending (tag) { return this.state.pending?.[tag] },
    feedback (tag) { return this.state.feedback?.[tag] },
    formatNumber (value) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—' },
    percent (value) { return typeof value === 'number' ? Math.min(100, Math.max(0, value)) : 0 },
    timestamp (value) { return value ? new Date(value).toLocaleTimeString('es-PE') : '—' },
    freshLabel (tag) {
      const at = this.state.lastSeen?.[tag]
      return at && Date.now() - at < 6000 ? 'Actualizado' : 'Sin lectura'
    },
    spark (tag) {
      const points = this.state.history?.[tag] || []
      if (!points.length) return ''
      const start = points[0].t
      const span = Math.max(1, points[points.length - 1].t - start)
      return points.map(p => `${((p.t - start) / span * 100).toFixed(1)},${(34 - Math.min(100, Math.max(0, p.v)) * 0.32).toFixed(1)}`).join(' ')
    },
    statusClass (tag) {
      if (!this.state.online) return 'muted'
      if (tag === 'Alarma_Nivel') return this.value(tag) ? 'alarm' : 'normal'
      return this.value(tag) ? 'active' : 'muted'
    },
    statusText (tag) {
      if (!this.state.online) return 'Sin datos'
      if (tag === 'Alarma_Nivel') return this.value(tag) ? 'ALARMA' : 'Normal'
      if (tag === 'Proceso_Activo') return this.value(tag) ? 'En marcha' : 'Detenido'
      return this.value(tag) ? 'Activo' : 'Inactivo'
    },
    sendCommand (tag, value) { if (this.state.online) this.send({ topic: 'command', payload: { tag, value } }) },
    apply (tag) {
      const value = Number(this.drafts[tag])
      if (!Number.isFinite(value) || value < 0 || value > 100 || this.drafts[tag] === '') return
      this.editing[tag] = false
      this.sendCommand(tag, value)
    }
  }
}
</script>

<style>
.flotation-dashboard{font-family:Inter,Segoe UI,Arial,sans-serif;color:#e9f1f8;background:#09131e;padding:30px;min-height:100vh;box-sizing:border-box;max-width:1600px;margin:auto}
.flotation-dashboard *{box-sizing:border-box}.dash-header{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:20px}.eyebrow{font-size:11px;letter-spacing:2.1px;color:#6da6bd;font-weight:800}.dash-header h1{font-size:34px;line-height:1.1;margin:8px 0;color:#f6fbff}.dash-header p{color:#91a9b9;margin:0;font-size:14px}.connection{display:flex;gap:12px;align-items:center;padding:12px 16px;border:1px solid #284255;border-radius:12px;background:#122232;min-width:220px}.connection.online{border-color:#2c785f}.connection.offline{border-color:#995150}.connection-dot{width:11px;height:11px;border-radius:50%;background:#ef7979;box-shadow:0 0 0 5px #ef79791a}.connection.online .connection-dot{background:#72d6a4;box-shadow:0 0 0 5px #72d6a41a}.connection strong,.connection small{display:block}.connection strong{font-size:12px;letter-spacing:1px}.connection small{font-size:11px;color:#91a9b9;margin-top:3px}.notice{border:1px solid #244157;background:#112636;color:#b7d5e4;border-radius:10px;padding:11px 15px;font-size:13px;margin-bottom:22px}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.metric-card,.panel{background:#111f2c;border:1px solid #263b4c;border-radius:16px;box-shadow:0 12px 30px #00000016}.metric-card{padding:18px;overflow:hidden}.metric-top,.metric-bottom{display:flex;justify-content:space-between;align-items:center;gap:8px}.metric-top{color:#adbfca;font-size:13px;font-weight:650}.metric-code{font-size:10px;color:#547b90;letter-spacing:1.2px}.metric-reading{font-size:40px;font-weight:750;letter-spacing:-1.8px;margin:13px 0 12px}.metric-reading span{font-size:17px;color:#6f91a4;margin-left:5px}.metric-track{height:5px;border-radius:10px;background:#284052;overflow:hidden}.metric-track div{height:100%;border-radius:10px}.sparkline{display:block;width:100%;height:48px;margin:11px 0 5px}.metric-bottom{color:#668397;font-size:11px}.lower-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,1fr);gap:16px;margin-top:16px}.panel{padding:22px}.section-heading{display:flex;align-items:end;justify-content:space-between;margin-bottom:17px}.section-heading h2{font-size:20px;margin:4px 0 0}.section-hint{font-size:11px;color:#7394a7}.control-row{display:grid;grid-template-columns:minmax(150px,1fr) auto;gap:4px 16px;padding:16px 0;border-bottom:1px solid #263b4c}.control-copy strong,.control-copy small,.status-row strong,.status-row small{display:block}.control-copy strong,.status-row strong{font-size:14px}.control-copy small,.status-row small{font-size:11px;color:#6f92a6;margin-top:4px}.control-action{display:flex;gap:9px}.number-field{display:flex;align-items:center;border:1px solid #3d5b70;border-radius:8px;background:#0b1a27;padding-right:9px;color:#81a7bc}.number-field input{width:83px;border:0;background:transparent;color:#f2f8fc;padding:9px 10px;font:inherit;outline:none}.number-field input:disabled{opacity:.5}.primary-btn,.toggle-btn,.start-btn,.stop-btn{border:0;border-radius:8px;padding:9px 14px;font-weight:750;cursor:pointer;font-size:12px}.primary-btn{background:#42b9d4;color:#09202b}.toggle-btn{background:#344758;color:#d1e0e9;min-width:100px}.toggle-btn.active,.start-btn{background:#56c994;color:#08291d}.stop-btn{background:#e88279;color:#32100e}.primary-btn:disabled,.toggle-btn:disabled,.start-btn:disabled,.stop-btn:disabled{opacity:.4;cursor:not-allowed}.feedback{grid-column:1/-1;min-height:16px;font-size:11px;color:#7b9bab}.feedback.ok{color:#74d9a7}.feedback.pending{color:#ffcb77}.feedback.error{color:#ff8a85}.process-controls{display:grid;grid-template-columns:minmax(150px,1fr) auto;gap:7px 16px;padding-top:18px}.process-buttons{display:flex;gap:8px}.status-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid #263b4c}.status-pill{border:1px solid #3e5364;color:#9aaeba;background:#1b2d3b;border-radius:999px;font-size:11px;font-weight:800;padding:6px 10px;min-width:88px;text-align:center;white-space:nowrap}.status-pill i{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:6px}.status-pill.active,.status-pill.normal{color:#7bddaa;border-color:#2d765b;background:#17352d}.status-pill.alarm{color:#ff918d;border-color:#985251;background:#3b2429}.source-box{margin-top:18px;padding:14px;border-radius:10px;background:#0b1b28;border:1px solid #273d4d}.source-box strong{font-size:12px}.source-box p{margin:5px 0 0;color:#7e9bab;font-size:12px;line-height:1.45}.flotation-dashboard footer{font-size:11px;color:#5d7c90;padding:20px 0 0}@media(max-width:1100px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.lower-grid{grid-template-columns:1fr}}@media(max-width:650px){.flotation-dashboard{padding:18px}.dash-header{align-items:flex-start;flex-direction:column}.dash-header h1{font-size:28px}.connection{width:100%}.metric-grid{grid-template-columns:1fr}.control-row,.process-controls{grid-template-columns:1fr}.control-action,.process-buttons{justify-content:flex-start}.section-hint{display:none}}
</style>
