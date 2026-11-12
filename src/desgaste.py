"""Modelo de perda de margem de EGT ao longo dos ciclos de voo (EFC).

Base empírica (Aircraft Commerce nº 58, 2008, entrevista com a TAP M&E):
  "as taxas iniciais de perda de margem de EGT do -7B24, -7B26 e -7B27 serão de
   11-15 graus nos primeiros 1.000 EFC; depois caem para 4-6 graus por 1.000 EFC",
  e as taxas "chegam ao nível maduro depois de ~3.000 EFC".

Por que a curva tem esse formato:
  - Amaciamento: no começo, as pontas das pás e os selos se desgastam rápido e as
    folgas aumentam. Mais ar escapa pelas pontas, a eficiência cai e a EGT sobe.
    Esse efeito se esgota (as folgas "acomodam"), por isso usamos uma exponencial.
  - Fase madura: erosão lenta e contínua das pás (poeira, areia) e sujeira,
    por isso uma reta.

    perda(n) = A × (1 − e^(−n/τ)) + taxa × n

  A   = quanto de margem se perde no amaciamento (°C)
  τ   = "constante de tempo" do amaciamento (EFC): depois de ~3τ, acabou
  taxa = perda madura (°C por EFC)
"""
from dataclasses import dataclass

import numpy as np
from scipy.optimize import brentq

TAU_AMACIAMENTO = 700.0  # EFC: com isso, 95% do amaciamento acontece até ~2.100 EFC (maduro ~3.000)


@dataclass(frozen=True)
class Desgaste:
    perda_1000_efc: float = 13.0   # °C perdidos nos primeiros 1.000 EFC (fonte: 11–15)
    taxa_madura: float = 5.0       # °C por 1.000 EFC na fase madura (fonte: 4–6)
    tau: float = TAU_AMACIAMENTO

    @property
    def amaciamento(self) -> float:
        """A, calculado para que a perda em 1.000 EFC bata com o valor publicado:
        A × (1 − e^(−1000/τ)) + taxa × 1000 = perda_1000_efc"""
        return (self.perda_1000_efc - self.taxa_madura) / (1 - np.exp(-1000 / self.tau))

    def perda(self, efc):
        efc = np.asarray(efc, dtype=float)
        return self.amaciamento * (1 - np.exp(-efc / self.tau)) + self.taxa_madura / 1000 * efc

    def margem(self, margem_inicial, efc):
        return margem_inicial - self.perda(efc)

    def ciclos_ate(self, margem_inicial, margem_minima=0.0) -> float:
        """Quantos EFC até a margem cair para margem_minima (padrão: zero)."""
        return brentq(lambda n: self.margem(margem_inicial, n) - margem_minima, 0, 200_000)


# Cenários para mostrar a incerteza das fontes (faixas 11–15 e 4–6)
OTIMISTA = Desgaste(perda_1000_efc=11.0, taxa_madura=4.0)
NOMINAL = Desgaste()
PESSIMISTA = Desgaste(perda_1000_efc=15.0, taxa_madura=6.0)
