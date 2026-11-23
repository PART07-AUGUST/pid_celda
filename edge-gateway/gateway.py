"""Read-only S7 edge gateway for the Render PID dashboard.

This process runs on a computer in the PLC's LAN. It reads DB1 over S7 PUT/GET
and posts telemetry to the dashboard over outbound HTTPS. It never writes to
the PLC and does not run Node-RED locally.
"""

from __future__ import annotations

import logging
import json
import math
import os
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from s7 import Client, util


LOG = logging.getLogger("pid-celda-s7-edge")


def load_local_env() -> None:
    """Load the project .env.edge for native Windows runs; preserve OS env values."""
    env_path = Path(__file__).resolve().parent.parent / ".env.edge"
    if not env_path.is_file():
        return

    for line_number, raw_line in enumerate(env_path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key or not key.replace("_", "").isalnum():
            raise ValueError(f"Formato inválido en .env.edge, línea {line_number}.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_local_env()
DB_NUMBER = int(os.getenv("PLC_DB_NUMBER", "1"))
DB_READ_START = 0
DB_READ_SIZE = 54

REAL_OFFSETS = {
    "Nivel_Pulpa": 0,
    "Caudal_Aire": 4,
    "Dosificacion_Reactivo": 8,
    "Recuperacion_Estimada": 14,
    "SP_Nivel": 20,
    "PV_Nivel": 24,
    "Salida_PID": 28,
    "Kp": 32,
    "Ki": 36,
    "Kd": 40,
    "Diferencia_Nivel": 46,
    "Cambio_Nivel": 50,
}
BOOL_OFFSETS = {
    "Agitador_ON": (12, 0),
    "Alarma_Nivel": (18, 0),
    "Simulacion_Activa": (18, 1),
    "Orden_Star": (18, 2),
    "Orden_Stop": (18, 3),
    "Proceso_Activo": (18, 4),
    "PID_Habilitado": (44, 0),
}


def read_plc_values(client: Client) -> dict[str, Any]:
    block = client.db_read(DB_NUMBER, DB_READ_START, DB_READ_SIZE)
    values: dict[str, Any] = {}

    for tag, offset in REAL_OFFSETS.items():
        value = float(util.get_real(block, offset))
        if not math.isfinite(value):
            raise ValueError(f"El valor leído para {tag} no es finito.")
        values[tag] = value

    for tag, (byte_offset, bit_offset) in BOOL_OFFSETS.items():
        values[tag] = bool(util.get_bool(block, byte_offset, bit_offset))

    return values


def post_telemetry(values: dict[str, Any], *, connected: bool, error: str = "") -> dict[str, Any]:
    base_url = os.environ["RENDER_BASE_URL"].rstrip("/")
    token = os.environ["EDGE_API_TOKEN"]
    payload: dict[str, Any] = {
        "connected": connected,
        "timestamp": int(time.time() * 1000),
        "values": values,
    }
    if error:
        payload["error"] = error[:240]

    request = Request(
        f"{base_url}/api/edge/telemetry",
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            body = response.read()
            return json.loads(body.decode("utf-8")) if body else {}
    except HTTPError as exc:
        detail = exc.read(512).decode("utf-8", errors="replace")
        raise RuntimeError(f"Render respondió HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"No se pudo contactar con Render: {exc.reason}") from exc


def run() -> None:
    required = ("PLC_IP", "RENDER_BASE_URL", "EDGE_API_TOKEN")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError("Faltan variables de entorno: " + ", ".join(missing))

    plc_ip = os.environ["PLC_IP"]
    plc_port = int(os.getenv("PLC_PORT", "102"))
    rack = int(os.getenv("PLC_RACK", "0"))
    slot = int(os.getenv("PLC_SLOT", "1"))
    poll_seconds = max(0.5, float(os.getenv("PLC_POLL_SECONDS", "1.0")))
    reconnect_seconds = max(1.0, float(os.getenv("PLC_RECONNECT_SECONDS", "5")))
    last_api_warning = 0.0

    while True:
        client = Client()
        try:
            LOG.info("Conectando al PLC S7 %s:%s, rack %s, slot %s", plc_ip, plc_port, rack, slot)
            client.connect(plc_ip, rack, slot, plc_port)
            LOG.info("Sesión S7 lista; DB%d se leerá cada %.1f s", DB_NUMBER, poll_seconds)

            while True:
                cycle_started = time.monotonic()
                values = read_plc_values(client)
                try:
                    post_telemetry(values, connected=True)
                except Exception as exc:
                    if time.monotonic() - last_api_warning >= 5:
                        LOG.warning("No se pudo publicar telemetría en Render: %s", exc)
                        last_api_warning = time.monotonic()
                else:
                    last_api_warning = 0.0
                    LOG.debug("SP_Nivel=%s, PV_Nivel=%s, Salida_PID=%s", values["SP_Nivel"], values["PV_Nivel"], values["Salida_PID"])

                elapsed = time.monotonic() - cycle_started
                time.sleep(max(0.0, poll_seconds - elapsed))

        except KeyboardInterrupt:
            LOG.info("Pasarela detenida por el operador.")
            return
        except Exception as exc:
            LOG.error("Conexión S7 interrumpida: %s", exc)
            try:
                post_telemetry({}, connected=False, error=str(exc))
            except Exception as report_exc:
                LOG.warning("No se pudo notificar la desconexión a Render: %s", report_exc)
        finally:
            try:
                client.disconnect()
            except Exception:
                pass

        time.sleep(reconnect_seconds)


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    run()
