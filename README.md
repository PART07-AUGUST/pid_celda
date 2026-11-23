# Dashboard PID · Celda de flotación

Node-RED y FlowFuse Dashboard se ejecutan en Render. Una pasarela Python en la laptop del laboratorio lee el S7-1200 mediante S7/PUT-GET y publica las lecturas hacia Render por HTTPS. La pasarela no ejecuta Node-RED ni escribe en el PLC.

```text
PLC S7-1200 ── S7/102 ──> Pasarela Python en la red del laboratorio
                                      │ HTTPS saliente + token
                                      ▼
                              API Node-RED en Render ──> Dashboard
```

Render no puede conectar directamente con una IP privada como `192.168.0.1`. La pasarela sí debe ejecutarse en un equipo que pueda alcanzar el PLC y tenga salida a Internet. No se abren puertos entrantes ni se expone el puerto S7 102 a Internet.

TIA Portal puede permanecer dentro de una VM sin Internet. La opción recomendada es ejecutar la pasarela Python en Windows anfitrión: el anfitrión usa Ethernet para llegar al PLC y Wi-Fi (u otra conexión) para llegar a Render. No hace falta instalar Node-RED en la VM ni darle Internet a TIA Portal.

## Lecturas S7

El gateway usa `python-snap7` 3.5.0 y solo lee el DB1. El tamaño de lectura es 54 bytes desde el offset 0. Los offsets provienen de la tabla compartida de TIA Portal.

| Tag | Dirección S7 | Tipo |
| --- | --- | --- |
| `Nivel_Pulpa` | `DB1,REAL0` | REAL |
| `Caudal_Aire` | `DB1,REAL4` | REAL |
| `Dosificacion_Reactivo` | `DB1,REAL8` | REAL |
| `Agitador_ON` | `DB1,X12.0` | BOOL |
| `Recuperacion_Estimada` | `DB1,REAL14` | REAL |
| `Alarma_Nivel` | `DB1,X18.0` | BOOL |
| `Simulacion_Activa` | `DB1,X18.1` | BOOL |
| `Orden_Star` | `DB1,X18.2` | BOOL |
| `Orden_Stop` | `DB1,X18.3` | BOOL |
| `Proceso_Activo` | `DB1,X18.4` | BOOL |
| `SP_Nivel` | `DB1,REAL20` | REAL |
| `PV_Nivel` | `DB1,REAL24` | REAL |
| `Salida_PID` | `DB1,REAL28` | REAL |
| `Kp` | `DB1,REAL32` | REAL |
| `Ki` | `DB1,REAL36` | REAL |
| `Kd` | `DB1,REAL40` | REAL |
| `PID_Habilitado` | `DB1,X44.0` | BOOL |
| `Diferencia_Nivel` | `DB1,REAL46` | REAL |
| `Cambio_Nivel` | `DB1,REAL50` | REAL |

El formato de lectura de `REAL` es IEEE-754 de 32 bits. La conexión S7-1200 requiere PUT/GET y un DB con acceso optimizado desactivado para direccionarlo por offsets. [Documentación de python-snap7](https://python-snap7.readthedocs.io/en/3.5.0/API/client.html) · [Requisitos de node-red-contrib-s7 para S7-1200](https://github.com/oriolrius/node-red-contrib-s7#notes-on-s7-12001500).

## API de Render

Se reutiliza `POST /api/edge/telemetry`; no se crea una ruta duplicada. La petición lleva `Authorization: Bearer <EDGE_API_TOKEN>` y este cuerpo:

```json
{
  "connected": true,
  "timestamp": 1795450000000,
  "values": {
    "SP_Nivel": 60.0,
    "PV_Nivel": 50.0,
    "Salida_PID": 48.0
  }
}
```

Los valores del ejemplo son demostrativos. El gateway envía los tags leídos desde DB1 aproximadamente cada segundo. Cuando pierde la conexión con el PLC, publica el estado desconectado; si pierde Internet, Render marca los datos como obsoletos al vencer `EDGE_STALE_MS`.

## Configurar Render

En el servicio existente, agrega o confirma estas variables desde **Environment**:

- `PID_DATA_MODE=simulation` mientras se prepara la pasarela; cámbialo a `plc` cuando los datos estén llegando.
- `EDGE_API_TOKEN`: secreto compartido con `.env.edge`.
- `EDGE_STALE_MS=5000`.
- `DASHBOARD_AUTH_USER` y `DASHBOARD_AUTH_PASSWORD` antes de activar el modo `plc`.

El dashboard queda en solo lectura cuando `PID_DATA_MODE=plc`; la simulación conserva sus controles. Como el servicio de Render ya existe, agrega manualmente las variables secretas: en un Blueprint, `sync: false` solo pide esos valores al crear inicialmente el servicio.

## Ejecutar la pasarela en Windows anfitrión

Haz estos pasos en Windows de la laptop, fuera de la VM. El anfitrión debe tener conectados el cable Ethernet del PLC y una conexión a Internet, por ejemplo Wi-Fi.

1. Abre PowerShell en el anfitrión y comprueba las dos rutas:

   ```powershell
   Test-NetConnection 192.168.0.1 -Port 102
   Test-NetConnection pid-celda.onrender.com -Port 443
   ```

   Ambas pruebas deben indicar `TcpTestSucceeded : True`. La primera comprueba el camino al PLC por Ethernet; la segunda, el acceso HTTPS a Render. Ejecuta estas pruebas desde el anfitrión, no desde TIA Portal ni desde esta sesión de Codex.

2. Confirma que el PLC está en RUN, PUT/GET está aplicado en la CPU y `DB1` no tiene acceso optimizado. No descargues cambios de hardware si TIA advierte que reemplazará datos del PLC hasta revisar esa descarga.

3. Copia el ejemplo y edita el archivo local; `.env.edge` está excluido de Git:

   ```powershell
   Copy-Item edge-gateway/example.env .env.edge
   notepad .env.edge
   ```

   Usa `PLC_IP=192.168.0.1`, rack `0`, slot `1`, puerto `102`, y pega el mismo `EDGE_API_TOKEN` que configuraste en Render. `RENDER_BASE_URL` apunta por defecto a `https://pid-celda.onrender.com`.

4. Instala el gateway y ejecútalo desde PowerShell. El gateway carga `.env.edge` automáticamente:

   ```powershell
   py -3 -m venv .venv-edge
   .\.venv-edge\Scripts\python.exe -m pip install -r edge-gateway\requirements.txt
   .\.venv-edge\Scripts\python.exe edge-gateway\gateway.py
   ```

   Esta instalación de Python corre solo la pasarela; no corre Node-RED. Si `py` no existe, instala Python 3 en el Windows anfitrión.

5. Cuando la consola indique que conecta y publica datos, en Render cambia `PID_DATA_MODE` a `plc` y despliega. El dashboard debe mostrar estado PLC S7 conectado y las tendencias recibidas.

Si el Windows anfitrión tampoco tiene Internet, se puede añadir a la VM un segundo adaptador de red **NAT** para Internet y mantener el adaptador **Bridged** conectado a la Ethernet del PLC. Luego se ejecutaría la pasarela dentro de la VM; sus dos pruebas de red deben pasar allí. La VM no debe usar solo NAT para llegar al PLC.

La pasarela no contiene funciones S7 de escritura ni sondea mandos desde Render. Por eso las tarjetas y controles se mantienen en solo lectura en modo PLC. Node-RED permanece únicamente en Render.

## OPC UA

Esta ruta S7→HTTPS no es OPC UA. Si el docente exige OPC UA, habrá que agregar un servidor OPC UA en la red del laboratorio y resolver el acceso remoto mediante red privada/VPN; el puerto 4840 no se expone directamente a Internet. Ese componente no está habilitado en la integración actual.

## Simulación local

Para abrir el dashboard simulado localmente:

```powershell
docker compose up --build
```

- Editor Node-RED: `http://localhost:1881/`
- Dashboard: `http://localhost:1881/dashboard`

La instancia local es solo para la demostración. El gateway PLC se inicia aparte con `compose.edge.yaml`.
