import unittest

from model import CellModel


class CellModelTests(unittest.TestCase):
    def test_inactive_process_has_no_recovery(self):
        model = CellModel()
        values = model.step(5, air=100, reagent=100, agitator=True, process_active=False)
        self.assertEqual(values["Recuperacion_Estimada"], 0)
        self.assertFalse(values["Alarma_Nivel"])

    def test_active_process_responds_to_virtual_actuators(self):
        model = CellModel()
        low = model.step(5, air=0, reagent=0, agitator=False, process_active=True)
        high = model.step(5, air=100, reagent=100, agitator=True, process_active=True)
        self.assertGreater(high["Recuperacion_Estimada"], low["Recuperacion_Estimada"])
        self.assertTrue(high["Simulacion_Activa"])
        self.assertGreaterEqual(high["Nivel_Pulpa"], 0)
        self.assertLessEqual(high["Nivel_Pulpa"], 100)


if __name__ == "__main__":
    unittest.main()
