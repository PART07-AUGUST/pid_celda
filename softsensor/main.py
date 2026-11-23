"""Servidor OPC UA de prueba o cliente de las etiquetas del S7-1200."""

import asyncio
import logging
import os
import time
from pathlib import Path

from asyncua import Client, Server, ua
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256

from model import CellModel


LOG = logging.getLogger("softsensor")
TAGS = {
    "Nivel_Pulpa": (50.0, ua.VariantType.Float),
    "Caudal_Aire": (20.0, ua.VariantType.Float),
    "Dosificacion_Reactivo": (5.0, ua.VariantType.Float),
    "Agitador_ON": (False, ua.VariantType.Boolean),
    "Recuperacion_Estimada": (0.0, ua.VariantType.Float),
    "Alarma_Nivel": (False, ua.VariantType.Boolean),
    "Simulacion_Activa": (True, ua.VariantType.Boolean),
    "Orden_Star": (False, ua.VariantType.Boolean),
    "Orden_Stop": (False, ua.VariantType.Boolean),
    "Proceso_Activo": (False, ua.VariantType.Boolean),
}
OPERATOR_WRITABLE = {"Caudal_Aire", "Dosificacion_Reactivo", "Agitador_ON", "Orden_Star", "Orden_Stop"}
MODEL_OUTPUTS = ("Nivel_Pulpa", "Recuperacion_Estimada", "Alarma_Nivel", "Simulacion_Activa")


def node_id(tag: str) -> str:
    value = os.getenv("NODEID_" + tag)
    if not value:
        raise ValueError("Falta NODEID_" + tag)
    return value


async def serve_demo() -> None:
    """Emula las etiquetas del DB y la lógica básica de arranque/parada del PLC."""
    server = Server()
    await server.init()
    server.set_endpoint(os.getenv("DEMO_OPCUA_BIND", "opc.tcp://0.0.0.0:4840/celda/"))
    server.set_server_name("DB_Flotacion virtual para pruebas")
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
    index = await server.register_namespace("urn:celda:flotacion:demo")
    obj = await server.nodes.objects.add_object(ua.NodeId("DB_Flotacion", index), "DB_Flotacion")
    nodes = {}
    for tag, (initial, kind) in TAGS.items():
        nodes[tag] = await obj.add_variable(
            ua.NodeId("DB_Flotacion." + tag, index), tag, initial, varianttype=kind
        )
        if tag in OPERATOR_WRITABLE:
            await nodes[tag].set_writable()
    LOG.info("Servidor OPC UA demo listo: namespace=%s, %s etiquetas", index, len(nodes))

    model = CellModel()
    active = False
    previous_start = False
    previous_stop = False
    last = time.monotonic()
    async with server:
        while True:
            start = bool(await nodes["Orden_Star"].read_value())
            stop = bool(await nodes["Orden_Stop"].read_value())
            if start and not previous_start:
                active = True
            if stop and not previous_stop:
                active = False
            previous_start, previous_stop = start, stop
            await nodes["Proceso_Activo"].write_value(active)
            current = time.monotonic()
            dt = current - last
            last = current
            values = model.step(
                dt,
                air=await nodes["Caudal_Aire"].read_value(),
                reagent=await nodes["Dosificacion_Reactivo"].read_value(),
                agitator=bool(await nodes["Agitador_ON"].read_value()),
                process_active=active,
            )
            for tag, value in values.items():
                await nodes[tag].write_value(ua.Variant(value, TAGS[tag][1]))
            await asyncio.sleep(0.1)


async def configure_client(client: Client) -> None:
    policy = os.getenv("OPCUA_SECURITY_POLICY", "None")
    if policy == "Basic256Sha256":
        cert = os.getenv("OPCUA_CLIENT_CERT", "")
        key = os.getenv("OPCUA_CLIENT_KEY", "")
        server_cert = os.getenv("OPCUA_SERVER_CERT", "")
        for filename in (cert, key, server_cert):
            if not filename or not Path(filename).is_file():
                raise ValueError("Certificado o clave OPC UA ausente: " + filename)
        await client.set_security(
            SecurityPolicyBasic256Sha256,
            certificate=cert,
            private_key=key,
            server_certificate=server_cert,
        )
    elif policy != "None":
        raise ValueError("Política OPC UA no admitida: " + policy)
    if username := os.getenv("OPCUA_USERNAME"):
        client.set_user(username)
        client.set_password(os.getenv("OPCUA_PASSWORD", ""))


async def write_model_outputs(nodes: dict, values: dict) -> None:
    for tag in MODEL_OUTPUTS:
        await nodes[tag].write_value(ua.Variant(values[tag], TAGS[tag][1]))


async def run_plc_client() -> None:
    """Lee actuadores/estado del PLC y publica sensores virtuales en su servidor OPC UA."""
    if os.getenv("SOFTSENSOR_ENABLE_WRITES") != "1":
        raise ValueError("SOFTSENSOR_ENABLE_WRITES=1 es obligatorio para escribir en el PLC")
    endpoint = os.getenv("OPCUA_ENDPOINT", "")
    if not endpoint.startswith("opc.tcp://"):
        raise ValueError("OPCUA_ENDPOINT debe ser una URL opc.tcp:// válida")
    ids = {tag: node_id(tag) for tag in (*MODEL_OUTPUTS, "Caudal_Aire", "Dosificacion_Reactivo", "Agitador_ON", "Proceso_Activo")}
    model = CellModel()
    while True:
        try:
            client = Client(url=endpoint, timeout=60)
            await configure_client(client)
            async with client:
                nodes = {tag: client.get_node(address) for tag, address in ids.items()}
                LOG.info("Soft sensor conectado al PLC: %s", endpoint)
                last = time.monotonic()
                while True:
                    current = time.monotonic()
                    values = model.step(
                        current - last,
                        air=await nodes["Caudal_Aire"].read_value(),
                        reagent=await nodes["Dosificacion_Reactivo"].read_value(),
                        agitator=bool(await nodes["Agitador_ON"].read_value()),
                        process_active=bool(await nodes["Proceso_Activo"].read_value()),
                    )
                    last = current
                    await write_model_outputs(nodes, values)
                    await asyncio.sleep(1.0)
        except (OSError, TimeoutError, ua.UaError) as exc:
            LOG.warning("Conexión OPC UA interrumpida: %s; reintento en 5 s", exc)
            await asyncio.sleep(5)


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    mode = os.getenv("SOFTSENSOR_MODE", "server")
    asyncio.run(serve_demo() if mode == "server" else run_plc_client())
