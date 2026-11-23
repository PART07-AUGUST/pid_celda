import asyncio
import os
import unittest
from unittest.mock import patch

from asyncua import Client, ua

from main import serve_demo


class OpcDemoTests(unittest.IsolatedAsyncioTestCase):
    async def test_tags_commands_and_virtual_sensor(self):
        endpoint = "opc.tcp://127.0.0.1:4841/celda/"
        with patch.dict(os.environ, {"DEMO_OPCUA_BIND": endpoint}):
            task = asyncio.create_task(serve_demo())
            try:
                await asyncio.sleep(0.7)
                async with Client(url=endpoint) as client:
                    nodes = {
                        tag: client.get_node("ns=2;s=DB_Flotacion." + tag)
                        for tag in ("Nivel_Pulpa", "Caudal_Aire", "Orden_Star", "Orden_Stop", "Proceso_Activo", "Recuperacion_Estimada")
                    }
                    self.assertEqual(await nodes["Nivel_Pulpa"].read_value(), 50.0)
                    await nodes["Caudal_Aire"].write_value(ua.Variant(40.0, ua.VariantType.Float))
                    self.assertEqual(await nodes["Caudal_Aire"].read_value(), 40.0)
                    await nodes["Orden_Star"].write_value(True)
                    await asyncio.sleep(0.25)
                    self.assertTrue(await nodes["Proceso_Activo"].read_value())
                    self.assertGreater(await nodes["Recuperacion_Estimada"].read_value(), 0)
                    await nodes["Orden_Star"].write_value(False)
                    await nodes["Orden_Stop"].write_value(True)
                    await asyncio.sleep(0.25)
                    self.assertFalse(await nodes["Proceso_Activo"].read_value())
            finally:
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task


if __name__ == "__main__":
    unittest.main()
