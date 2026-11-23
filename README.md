# Dashboard de celda de flotación

Proyecto Node-RED para el bloque `DB_Flotacion` de un SIMATIC S7-1200. Incluye dashboard FlowFuse, cliente OPC UA y un **soft sensor** en Python. Por ahora los valores de proceso son simulados: no representan sensores físicos ni deben emplearse para operar una celda real.

## Arquitectura

```text
Python soft sensor ── OPC UA ──► DB_Flotacion / servidor de prueba ── OPC UA ──► Node-RED ──► Dashboard
                                   ▲                                     │
                                   └──── consignas y órdenes ◄───────────┘
```

- En la demo Docker, Python emula el servidor OPC UA y la lógica de arranque/parada del PLC. También calcula `Nivel_Pulpa`, `Recuperacion_Estimada` y `Alarma_Nivel` a partir de aire, reactivo, agitador y estado del proceso.
- Con un PLC físico, **el servidor OPC UA es el S7-1200**. Python se conecta como cliente, lee los actuadores virtuales/estado y escribe las cuatro señales simuladas. El bloque `FC_Control_Flotacion` del PLC procesa `Orden_Star` y `Orden_Stop` y actualiza `Proceso_Activo`.
- Node-RED lee las diez etiquetas, permite escribir solo `Caudal_Aire`, `Dosificacion_Reactivo` y `Agitador_ON`, y envía pulsos de 500 ms para arranque/parada. Comprueba las consignas mediante lectura posterior y las órdenes mediante `Proceso_Activo`.

| Etiqueta | Tipo | Uso en dashboard | Origen en modo PLC |
| --- | --- | --- | --- |
| `Nivel_Pulpa` | Real | Lectura y tendencia | Python simula y escribe |
| `Caudal_Aire` | Real | Consigna 0–100 % | Node-RED escribe; Python lee |
| `Dosificacion_Reactivo` | Real | Consigna 0–100 % | Node-RED escribe; Python lee |
| `Agitador_ON` | Bool | Encender/apagar | Node-RED escribe; Python lee |
| `Recuperacion_Estimada` | Real | Lectura y tendencia | Python calcula y escribe |
| `Alarma_Nivel` | Bool | Alarma | Python calcula y escribe |
| `Simulacion_Activa` | Bool | Estado | Python escribe `true` |
| `Orden_Star` | Bool | Pulso de arranque | Node-RED escribe |
| `Orden_Stop` | Bool | Pulso de parada | Node-RED escribe |
| `Proceso_Activo` | Bool | Estado del proceso | `FC_Control_Flotacion` en PLC |

`Orden_Star` conserva la grafía que aparece en la captura de TIA Portal. Si en el proyecto definitivo se llama `Orden_Start`, cambie el nombre en la configuración de NodeId y en el código antes de conectar.

## Ejecutar con Docker

Requiere Docker con el daemon en ejecución. Desde la carpeta del proyecto:

```sh
npm run build:flow
docker compose up --build
```

Abra [el dashboard](http://localhost:1880/dashboard/celda) o [el editor de Node-RED](http://localhost:1880/red/). La demo usa OPC UA de extremo a extremo entre los dos contenedores. Para permitir acceso desde la red local, establezca `DASHBOARD_BIND=0.0.0.0` antes de iniciar Compose; esto también expone el editor, por lo que debe limitar el acceso a una red de confianza.

La primera ejecución copia `flows-opc-demo.json` al volumen `node_red_demo_data`. Las modificaciones hechas en el editor persisten en ese volumen. Para cargar una versión regenerada del flujo, impórtela desde el editor o elimine el volumen de la demo de forma deliberada.

También se puede ejecutar solo Node-RED, sin Docker ni OPC UA, con `npm install` y `npm start`. Este modo usa `flows.json` y datos internos de prueba.

## Conectar al S7-1200 físico

La conexión física todavía **no está activada** porque faltan endpoint, seguridad y NodeIds reales. Cuando estén disponibles:

1. Verifique en TIA Portal que la CPU tenga firmware V4.4 o superior, licencia OPC UA Basic, servidor OPC UA activo, y permisos de lectura/escritura por etiqueta. Mantenga `Nivel_Pulpa`, `Recuperacion_Estimada`, `Alarma_Nivel` y `Simulacion_Activa` escribibles solo para el cliente Python autorizado; aire, reactivo, agitador y órdenes deben ser escribibles para Node-RED.
2. Obtenga los diez NodeIds con un cliente OPC UA y complete una copia local de `.env.plc.example` llamada `.env.plc`. Los `Real` Siemens se tratan como OPC UA `Float` y los `Bool` como `Boolean`.
3. Configure certificados y la política de seguridad en el servidor y en ambos clientes. El flujo `flows-plc.json` trae `Basic256Sha256` con `SignAndEncrypt` como punto de partida; ajuste esa configuración en el editor si el endpoint real difiere. No guarde claves ni certificados en Git.
4. Antes de permitir escrituras Python, confirme que el PLC no tenga sensores reales controlando esas cuatro señales y cambie `SOFTSENSOR_ENABLE_WRITES=1`. Inicie con `docker compose -f compose.plc.yaml up --build`.
5. Compruebe en línea que una consigna escrita vuelve como lectura, que los pulsos de 500 ms se reconocen y que `Proceso_Activo` responde. Si la comunicación OPC UA falla o se vuelven antiguas las lecturas, el dashboard bloquea nuevos mandos.

El contenedor Docker debe poder llegar a la IP del PLC. Si TIA Portal corre dentro de VMware, revise modo de red, subred y firewall. **Render no puede acceder directamente a una CPU en una red privada local**; el Blueprint incluido despliega solo la demo con servidor OPC UA de prueba. La conexión física se ejecuta en un equipo de la red industrial o mediante una red privada diseñada para ello.

## Render

`render.yaml` define un servicio web Node-RED y un servicio privado Python que expone OPC UA dentro de la red de Render. El dashboard público se sirve en `/dashboard/celda`; el editor de Node-RED está deshabilitado en Render. El Blueprint usa dos instancias de pago de tamaño mínimo (`0.5c-512mb`), una por servicio. Revise el costo antes de aplicar el Blueprint desde [Render](https://dashboard.render.com/blueprint/new?repo=https://github.com/PART07-AUGUST/pid_celda).

## Desarrollo y pruebas

```sh
npm install
npm run build:flow
npm test
py -m unittest discover -s softsensor -p 'test_*.py'
docker compose config --quiet
```

`src/dashboard.vue` contiene la interfaz y `src/state-function.js` la validación/estado de Node-RED. `scripts/build-flow.mjs` genera tres flujos importables: `flows.json` (demo local), `flows-opc-demo.json` (Docker/Render con servidor de prueba) y `flows-plc.json` (S7-1200 físico). El modelo Python está en `softsensor/model.py`.
