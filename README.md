# Control PID de nivel · Celda de flotación

Dashboard FlowFuse/Node-RED con dos fuentes de datos:

- `simulation`: modo de demostración sin PLC, activo por defecto.
- `opcua`: recibe tags del PLC mediante un gateway Python desplegado dentro de la red del S7-1200.

El dashboard puede permanecer en Render. El gateway es el único proceso que necesita llegar por Ethernet al PLC y publica los datos hacia Render por HTTPS. Node-RED en Render no puede enrutar directamente a una IP privada como `192.168.0.1`.

## Tags del PID

| Tag | Dirección desde el dashboard | Uso |
| --- | --- | --- |
| `SP_Nivel` | Escritura | Consigna 0–100 % |
| `PV_Nivel` | Lectura | Nivel usado por el PID |
| `Salida_PID` | Lectura | Salida que calcula el PLC |
| `Kp`, `Ki`, `Kd` | Lectura/escritura | Ganancias del controlador, 0–100 |
| `PID_Habilitado` | Lectura/escritura | Habilitación del PID |
| `Diferencia_Nivel`, `Cambio_Nivel` | Lectura | Valores calculados por el PLC/gateway |
| `Proceso_Activo` | Lectura | Estado del proceso |
| `Orden_Star`, `Orden_Stop` | Pulso de escritura | Mandos opcionales de arranque/parada |

La simulación mantiene el PID y la planta didáctica dentro de Node-RED. En modo OPC UA, `OB_PID_Flotacion` debe ser el único bloque que calcule la salida. El soft sensor Python lee `Salida_PID` y, si se habilita, actualiza `PV_Nivel` en el PLC.

## Configurar el PLC en TIA Portal

1. Verifica firmware, licencia y activa **OPC UA > Server** en las propiedades de la CPU.
2. Publica las tags necesarias en la interfaz del servidor OPC UA.
3. Permite lectura para las variables de estado. Permite escritura únicamente para `SP_Nivel`, `Kp`, `Ki`, `Kd`, `PID_Habilitado`, `Orden_Star` y `Orden_Stop` si se usarán esos mandos.
4. Compila y descarga la configuración a la CPU.
5. Anota el endpoint que informa TIA Portal. No se usan los offsets del DB como NodeIds OPC UA.

El gateway intenta encontrar NodeIds explorando los BrowseNames. Si un nombre del servidor no coincide con el tag de TIA, se puede fijar un mapa explícito mediante `OPCUA_NODE_IDS`.

## Preparar el servicio Node-RED en Render

El servicio expone estos endpoints, todos protegidos por `EDGE_API_TOKEN`:

- `POST /api/edge/telemetry`: recibe `{connected, timestamp, values, error?}`.
- `GET /api/edge/commands`: entrega los mandos pendientes del dashboard.
- `POST /api/edge/ack`: confirma el resultado y lectura posterior de cada escritura.

En las variables de entorno del servicio Render configura:

- `PID_DATA_MODE=simulation` mientras pruebas sin PLC.
- `EDGE_API_TOKEN` con un secreto largo generado en Render.
- `EDGE_STALE_MS=5000` para marcar desconexión cuando no llegan datos recientes.
- Antes de pasar a OPC UA, configura también `DASHBOARD_AUTH_USER` y `DASHBOARD_AUTH_PASSWORD`; el dashboard pedirá autenticación básica para permitir operaciones de escritura.

Como el servicio Render ya existe, agrega ahí estas variables desde **Environment**; `sync: false` solo solicita los valores al crear un Blueprint por primera vez. Usa el mismo `EDGE_API_TOKEN` en Render y `.env.edge`. Mantén `PID_DATA_MODE=simulation` mientras verificas el gateway; cuando esté conectado, cambia ese valor a `opcua` y guarda desplegando el servicio. Si no llegan datos, el dashboard indica desconexión y bloquea los mandos. `/api/healthz` es una ruta pública sin información del PLC y solo sirve al chequeo de salud de Render.

## Ejecutar el gateway Python

El gateway puede correr en la laptop de TIA para una primera prueba, o en otro equipo siempre encendido conectado a la red del PLC. No aloja el dashboard. Necesita conectividad al PLC por Ethernet e Internet saliente para comunicarse con Render.

1. Copia `edge-gateway/example.env` como `.env.edge`.
2. Edita `.env.edge`: coloca el endpoint OPC UA confirmado en TIA y el mismo `EDGE_API_TOKEN` configurado en Render. No subas `.env.edge` a Git.
3. Si el BrowseName no coincide con el tag, define `OPCUA_NODE_IDS` como JSON, por ejemplo:

   ```text
   OPCUA_NODE_IDS={"PV_Nivel":"ns=3;s=...","Salida_PID":"ns=3;s=..."}
   ```

4. Inicia el contenedor del gateway:

   ```powershell
   docker compose -f compose.edge.yaml up -d --build
   docker compose -f compose.edge.yaml logs -f opcua-edge-gateway
   ```

Variables principales del gateway:

- `OPCUA_ENDPOINT`, `OPCUA_USERNAME`, `OPCUA_PASSWORD` y opcionalmente `OPCUA_SECURITY_STRING`.
- `RENDER_BASE_URL` y `EDGE_API_TOKEN`.
- `SOFT_SENSOR_ENABLED=true` para simular el nivel escribiendo `PV_Nivel`; ponlo en `false` si esa señal viene de un sensor real.
- `SOFT_SENSOR_PV_TAG=PV_Nivel` permite mapear la medición simulada a otro tag, si el PLC usa un nombre distinto.

El gateway lee la salida del PID, actualiza el soft sensor opcional, publica las lecturas cada segundo y consulta mandos. Las escrituras de consigna/ganancias se confirman con una nueva lectura OPC UA. `Orden_Star` y `Orden_Stop` se escriben como pulsos breves.

## Ejecutar únicamente la demo local

```sh
docker compose up --build
```

- Editor Node-RED: `http://localhost:1881/`
- Dashboard: `http://localhost:1881/dashboard`

La demo local no requiere OPC UA. El dashboard Render también inicia en `simulation` hasta que se cambie `PID_DATA_MODE`.

## Límites y seguridad

El gateway abre conexiones salientes hacia Render; no requiere abrir puertos entrantes en la laptop ni publicar OPC UA del PLC a Internet. Las llamadas del gateway a Render usan HTTPS y token Bearer. Las contraseñas y certificados OPC UA van solo en `.env.edge` o en un almacén de secretos, nunca en el repositorio.

Si Python escribe `PV_Nivel`, confirma que ese es el valor que consume el PID del PLC. Si el PLC copia `Nivel_Pulpa` hacia `PV_Nivel`, configura `SOFT_SENSOR_PV_TAG` según el flujo real. Mantén validaciones de rango en el programa PLC y no ejecutes al mismo tiempo otro PID que escriba `Salida_PID`.

La conexión física no está validada todavía: faltan endpoint OPC UA, NodeIds confirmados y permisos efectivos en TIA. Hasta entonces, el modo de prueba continúa siendo la simulación.
