"""Modelo didáctico de sensores y actuadores virtuales de la celda."""

from dataclasses import dataclass


def clamp(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


@dataclass
class CellModel:
    level: float = 50.0
    recovery: float = 0.0

    def step(
        self,
        dt: float,
        *,
        air: float,
        reagent: float,
        agitator: bool,
        process_active: bool,
    ) -> dict[str, float | bool]:
        """Calcula señales simuladas; air/reagent/agitator son actuadores virtuales."""
        air = clamp(air)
        reagent = clamp(reagent)
        dt = max(0.0, min(5.0, dt))

        if process_active:
            target_level = clamp(50.0 + 0.12 * (air - 20.0) - 0.08 * (reagent - 5.0))
            self.level += (target_level - self.level) * min(1.0, dt / 25.0)
            target_recovery = clamp(
                35.0 + 0.32 * air + 0.6 * reagent + (8.0 if agitator else 0.0)
                - 0.2 * abs(self.level - 50.0)
            )
        else:
            target_recovery = 0.0

        self.level = clamp(self.level)
        self.recovery += (target_recovery - self.recovery) * min(1.0, dt / 8.0)
        self.recovery = clamp(self.recovery)
        return {
            "Nivel_Pulpa": round(self.level, 2),
            "Recuperacion_Estimada": round(self.recovery, 2),
            "Alarma_Nivel": self.level < 20.0 or self.level > 80.0,
            "Simulacion_Activa": True,
        }
