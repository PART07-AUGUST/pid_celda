# Control PID de nivel · Celda de flotación

Dashboard de Node-RED para visualizar y ajustar un lazo PID de nivel usando los nombres de variables de `DB_Flotacion` que aparecen en TIA Portal. La versión actual es una **simulación local**: calcula el PID dentro de Node-RED y modela una respuesta de proceso sencilla. No se conecta a la CPU S7-1200 ni envía órdenes a actuadores.

## Variables del lazo

| Tag | Uso |
| --- | --- |
| `SP_Nivel` | Consigna de nivel, ajustable entre 0 y 100 % |
| `PV_Nivel` | Nivel simulado del proceso |
| `Salida_PID` | Salida simulada del controlador, limitada a 0–100 % |
| `Kp` | Ganancia proporcional, ajustable de 0 a 100 |
| `Ki` | Ganancia integral, ajustable de 0 a 100 |
| `Kd` | Ganancia derivativa, ajustable de 0 a 100 |
| `PID_Habilitado` | Habilita o detiene el cálculo PID |

El ciclo PID corre cada segundo, usa derivada sobre la medición y limita la integral cuando la salida satura. Al deshabilitar, la salida queda retenida en el valor actual. Los valores iniciales (`SP=60`, `PV=50`, `Kp=2`, `Ki=0.1`, `Kd=0`) se tomaron de la captura compartida.

## Ejecutar con Docker

Requiere Docker con el daemon en ejecución:

```sh
docker compose up --build
```

Abre el dashboard en [http://localhost:1880/dashboard/celda](http://localhost:1880/dashboard/celda). El editor de Node-RED está en [http://localhost:1880/red/](http://localhost:1880/red/). Los cambios de flujo hechos en el editor quedan en el volumen `pid_celda_data`.

Para acceder desde otro equipo de la misma red, define `DASHBOARD_BIND=0.0.0.0` antes de iniciar Docker Compose y limita el acceso a una red de confianza.

## Ejecutar sin Docker

```sh
npm install
npm start
```

El flujo importable está en `flows.json`. El código de cálculo está en `src/state-function.js` y la interfaz en `src/dashboard.vue`.

## Modelo simulado y límites

El modelo supone que consigna y medición están en porcentaje de 0 a 100, que una salida mayor aumenta el nivel, y representa la planta con un retardo de primer orden más una pequeña perturbación. Es solo una planta didáctica para observar el comportamiento y ajustar parámetros; no es un modelo validado de flotación ni una conexión con el PID del PLC.

En esta versión el PID se calcula en Node-RED. Antes de una conexión física hay que definir un enlace directo con el PLC que no use OPC UA, confirmar el escalamiento/unidades/sentido de acción de `Salida_PID` y evitar que el PID de Node-RED y `FC_Control_Flotacion` actúen a la vez sobre la misma salida. El dashboard actual no debe usarse para accionar el proceso real.

## Render

`render.yaml` contiene un único servicio Docker para el dashboard simulado. El despliegue lo haces desde tu cuenta de Render; este proyecto no configura acceso al PLC ni túneles a una red industrial.
