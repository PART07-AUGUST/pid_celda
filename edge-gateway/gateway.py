"""OPC UA edge bridge for the flotation-cell dashboard.

Run this agent on a device that can reach the S7-1200 on its plant Ethernet and
can make outbound HTTPS requests to the Render dashboard. The PID loop remains
in the PLC; this process can optionally model the virtual process by updating
PV_Nivel from Salida_PID.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from asyncua import Client, ua


LOG = logging.getLogger("pid-celda-edge")
READ_TAGS = (
    "Nivel_Pulpa", "Caudal_Aire", "Dosificacion_Reactivo", "Agitador_ON",
    "Recuperacion_Estimada", "Alarma_Nivel", "Simulacion_Activa",
    "SP_Nivel", "PV_Nivel", "Salida_PID", "Kp", "Ki", "Kd",
    "PID_Habilitado", "Diferencia_Nivel", "Cambio_Nivel", "Proceso_Activo",
)
WRITABLE_NUMERIC = {"SP_Nivel", "Kp", "Ki", "Kd"}
WRITABLE_BOOLEAN = {"PID_Habilitado"}
PULSE_TAGS = {"Orden_Star", "Orden_Stop"}
REQUIRED_TAGS = {"SP_Nivel", "PV_Nivel", "Salida_PID", "Kp", "Ki", "Kd", "PID_Habilitado"}
FLOAT_TAGS = {
    "Nivel_Pulpa", "Caudal_Aire", "Dosificacion_Reactivo", "Recuperacion_Estimada",
    "SP_Nivel", "PV_Nivel", "Salida_PID", "Kp", "Ki", "Kd",
    "Diferencia_Nivel", "Cambio_Nivel",
}


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_node_ids() -> dict[str, str]:
    raw = os.getenv("OPCUA_NODE_IDS", "").strip()
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("OPCUA_NODE_IDS debe ser un objeto JSON {tag: NodeId}.")
    return {str(tag): str(node_id) for tag, node_id in parsed.items()}


def http_json(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    base_url = os.environ["RENDER_BASE_URL"].rstrip("/")
    token = os.environ["EDGE_API_TOKEN"]
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(f"{base_url}{path}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            content = response.read()
            return json.loads(content.decode("utf-8")) if content else {}
    except HTTPError as exc:
        detail = exc.read(512).decode("utf-8", errors="replace")
        raise RuntimeError(f"Render respondió HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"No se pudo contactar con Render: {exc.reason}") from exc


async def api(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return await asyncio.to_thread(http_json, method, path, payload)


def normalize_browse_name(name: str) -> str:
    cleaned = name.replace('"', "").strip()
    return cleaned.replace("\\", ".").split(".")[-1].split("/")[-1].strip()


async def browse_tag_nodes(client: Client) -> dict[str, Any]:
    targets = set(READ_TAGS) | set(WRITABLE_BOOLEAN) | set(WRITABLE_NUMERIC) | PULSE_TAGS
    found: dict[str, Any] = {}
    visited: set[str] = set()
    max_nodes = int(os.getenv("OPCUA_BROWSE_MAX_NODES", "4000"))
    max_depth = int(os.getenv("OPCUA_BROWSE_MAX_DEPTH", "10"))

    async def visit(node: Any, depth: int) -> None:
        if depth > max_depth or len(visited) >= max_nodes:
            return
        try:
            node_key = node.nodeid.to_string()
        except Exception:
            return
        if node_key in visited:
            return
        visited.add(node_key)
        try:
            children = await node.get_children()
        except Exception:
            return
        for child in children:
            try:
                browse_name = (await child.read_browse_name()).Name
                logical_name = normalize_browse_name(str(browse_name))
                if logical_name in targets and logical_name not in found:
                    found[logical_name] = child
                if len(visited) < max_nodes:
                    await visit(child, depth + 1)
            except Exception:
                continue

    await visit(client.nodes.objects, 0)
    return found


async def resolve_nodes(client: Client) -> dict[str, Any]:
    resolved = await browse_tag_nodes(client)
    explicit = load_node_ids()
    for tag, node_id in explicit.items():
        resolved[tag] = client.get_node(node_id)
    missing = sorted((set(READ_TAGS) | WRITABLE_NUMERIC | WRITABLE_BOOLEAN | PULSE_TAGS) - set(resolved))
    if missing:
        LOG.warning("Tags no encontradas por nombre/NodeId: %s", ", ".join(missing))
    missing_required = sorted(REQUIRED_TAGS - set(resolved))
    if missing_required:
        raise RuntimeError("Faltan tags PID obligatorias en OPC UA: " + ", ".join(missing_required))
    LOG.info("Tags OPC UA resueltas: %s", ", ".join(sorted(resolved)) or "ninguna")
    return resolved


async def read_values(nodes: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for tag in READ_TAGS:
        node = nodes.get(tag)
        if node is None:
            continue
        try:
            value = await node.read_value()
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                value = float(value)
                if math.isfinite(value):
                    values[tag] = value
            elif isinstance(value, bool):
                values[tag] = value
        except Exception as exc:
            LOG.debug("No se pudo leer %s: %s", tag, exc)
    return values


async def write_value(node: Any, tag: str, value: Any) -> Any:
    if tag in WRITABLE_NUMERIC:
        numeric = float(value)
        if not math.isfinite(numeric) or numeric < 0 or numeric > 100:
            raise ValueError(f"{tag} debe estar entre 0 y 100.")
        await node.write_value(ua.Variant(numeric, ua.VariantType.Float))
        return await node.read_value()
    if tag in WRITABLE_BOOLEAN:
        if not isinstance(value, bool):
            raise ValueError(f"{tag} requiere un valor booleano.")
        await node.write_value(ua.Variant(value, ua.VariantType.Boolean))
        return await node.read_value()
    if tag in PULSE_TAGS:
        if value is not True:
            raise ValueError(f"{tag} acepta únicamente un pulso de activación.")
        await node.write_value(ua.Variant(True, ua.VariantType.Boolean))
        await asyncio.sleep(max(0.1, min(1.0, float(os.getenv("PLC_COMMAND_PULSE_SECONDS", "0.25")))))
        await node.write_value(ua.Variant(False, ua.VariantType.Boolean))
        confirmed = await node.read_value()
        if confirmed is not False:
            raise RuntimeError(f"No se confirmó la liberación del pulso {tag}.")
        return confirmed
    raise ValueError(f"La tag {tag} no está autorizada para escritura desde el dashboard.")


class CommandJournal:
    """Avoid repeating a pulse if the ACK request is retried after a network loss."""

    def __init__(self) -> None:
        data_dir = Path(os.getenv("EDGE_STATE_DIR", "/data"))
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = data_dir / "processed-commands.json"
        try:
            self.entries = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(self.entries, dict):
                self.entries = {}
        except (OSError, json.JSONDecodeError):
            self.entries = {}

    def get(self, command_id: str) -> dict[str, Any] | None:
        return self.entries.get(command_id)

    def save(self, command_id: str, result: dict[str, Any]) -> None:
        self.entries[command_id] = result
        self.entries = dict(list(self.entries.items())[-500:])
        self.persist()

    def remove(self, command_id: str) -> None:
        self.entries.pop(command_id, None)
        self.persist()

    def persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent, delete=False) as tmp:
            json.dump(self.entries, tmp, separators=(",", ":"))
            temp_name = tmp.name
        os.replace(temp_name, self.path)


async def handle_commands(nodes: dict[str, Any], journal: CommandJournal) -> None:
    response = await api("GET", "/api/edge/commands")
    commands = response.get("commands", [])
    for command in commands:
        command_id = command.get("id")
        tag = command.get("tag")
        if not isinstance(command_id, str) or not isinstance(tag, str):
            continue

        prior = journal.get(command_id)
        if prior is None:
            try:
                node = nodes.get(tag)
                if node is None:
                    raise KeyError(f"No se encontró el NodeId de {tag}.")
                confirmed = await write_value(node, tag, command.get("value"))
                target = command.get("value")
                if tag not in PULSE_TAGS and confirmed != target:
                    if isinstance(target, float) and isinstance(confirmed, (int, float)):
                        if abs(float(confirmed) - target) > 0.001:
                            raise RuntimeError(f"Lectura de confirmación distinta: {confirmed}")
                    else:
                        raise RuntimeError(f"Lectura de confirmación distinta: {confirmed}")
                prior = {"id": command_id, "tag": tag, "ok": True, "value": confirmed, "pulse": tag in PULSE_TAGS}
            except Exception as exc:
                prior = {"id": command_id, "tag": tag, "ok": False, "error": str(exc)[:240]}
            journal.save(command_id, prior)

        try:
            await api("POST", "/api/edge/ack", prior)
            journal.remove(command_id)
        except Exception as exc:
            LOG.warning("ACK pendiente para %s: %s", command_id, exc)


async def connected_loop(client: Client, nodes: dict[str, Any], journal: CommandJournal) -> None:
    soft_sensor = env_bool("SOFT_SENSOR_ENABLED", True)
    pv_tag = os.getenv("SOFT_SENSOR_PV_TAG", "PV_Nivel")
    tick = max(0.2, float(os.getenv("EDGE_POLL_SECONDS", "1.0")))
    time_constant = max(1.0, float(os.getenv("SOFT_SENSOR_TIME_CONSTANT", "18")))
    last_tick = time.monotonic()
    disturbance_phase = time.time()
    last_report = 0.0

    while True:
        started = time.monotonic()
        values = await read_values(nodes)

        if soft_sensor and pv_tag in nodes and isinstance(values.get("Salida_PID"), (int, float)):
            current_pv = float(values.get(pv_tag, values.get("PV_Nivel", 50.0)))
            output = max(0.0, min(100.0, float(values["Salida_PID"])))
            dt = max(0.1, min(2.0, started - last_tick))
            target = max(0.0, min(100.0, output + 1.5 * math.sin((time.time() - disturbance_phase) / 18.0)))
            next_pv = max(0.0, min(100.0, current_pv + (target - current_pv) * min(1.0, dt / time_constant)))
            try:
                await nodes[pv_tag].write_value(ua.Variant(next_pv, ua.VariantType.Float))
                values[pv_tag] = next_pv
                if pv_tag == "PV_Nivel":
                    values["PV_Nivel"] = next_pv
                values["Cambio_Nivel"] = next_pv - current_pv
                if isinstance(values.get("SP_Nivel"), (int, float)):
                    values["Diferencia_Nivel"] = float(values["SP_Nivel"]) - next_pv
            except Exception as exc:
                LOG.warning("No se pudo escribir el soft sensor %s: %s", pv_tag, exc)

        try:
            await api("POST", "/api/edge/telemetry", {
                "connected": True,
                "timestamp": int(time.time() * 1000),
                "values": values,
            })
            last_report = time.monotonic()
        except Exception as exc:
            if time.monotonic() - last_report > 5:
                LOG.warning("No se pudo publicar telemetría en Render: %s", exc)
                last_report = time.monotonic()

        try:
            await handle_commands(nodes, journal)
        except Exception as exc:
            LOG.warning("No se pudieron consultar mandos de Render: %s", exc)

        last_tick = started
        await asyncio.sleep(max(0.0, tick - (time.monotonic() - started)))


async def run() -> None:
    for required in ("OPCUA_ENDPOINT", "RENDER_BASE_URL", "EDGE_API_TOKEN"):
        if not os.getenv(required):
            raise RuntimeError(f"Falta configurar la variable {required}.")

    journal = CommandJournal()
    reconnect_seconds = max(1.0, float(os.getenv("OPCUA_RECONNECT_SECONDS", "5")))
    while True:
        client = Client(url=os.environ["OPCUA_ENDPOINT"], timeout=10)
        username = os.getenv("OPCUA_USERNAME", "")
        password = os.getenv("OPCUA_PASSWORD", "")
        security = os.getenv("OPCUA_SECURITY_STRING", "")
        if username:
            client.set_user(username)
        if password:
            client.set_password(password)

        try:
            if security:
                await client.set_security_string(security)
            LOG.info("Conectando al servidor OPC UA %s", os.environ["OPCUA_ENDPOINT"])
            await client.connect()
            nodes = await resolve_nodes(client)
            LOG.info("Sesión OPC UA establecida; inicia envío de telemetría a Render.")
            await connected_loop(client, nodes, journal)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            LOG.error("Conexión OPC UA/gateway interrumpida: %s", exc)
            try:
                await api("POST", "/api/edge/telemetry", {
                    "connected": False,
                    "timestamp": int(time.time() * 1000),
                    "values": {},
                    "error": str(exc)[:240],
                })
            except Exception as report_exc:
                LOG.warning("No se pudo notificar la desconexión a Render: %s", report_exc)
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass
        await asyncio.sleep(reconnect_seconds)


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        LOG.info("Gateway detenido por el operador.")
