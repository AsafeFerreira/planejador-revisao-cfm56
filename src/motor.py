"""Modelo termodinâmico (0-D) de um turbofan de dois eixos, no estilo do CFM56-7B.

"0-D" quer dizer que cada parte do motor é tratada como uma caixa: entra ar com uma
temperatura e uma pressão, sai ar com outra. Não desenhamos pás nem escoamento
detalhado; usamos as leis de conservação de energia e as relações dos gases ideais.
É o mesmo tipo de cálculo de livros-texto de propulsão (Saravanamuttoo, Mattingly,
notas do curso 16.50 do MIT) e de bibliotecas como o pyCycle da NASA.

Numeração das estações (padrão SAE ARP755, a mesma dos manuais de motor):
    0   ar ambiente                     25  saída do booster / entrada do HPC
    2   entrada do fan                  3   saída do HPC
    13  saída do fan (lado do bypass)   4   saída da câmara / entrada da HPT
    21  saída do fan (lado do núcleo)   45  saída da HPT / entrada da LPT
    49.5 sonda de EGT (bocal do 2º estágio da LPT, segundo a ficha de certificação)
    5   saída da LPT                    18 / 8  bocais de bypass e do núcleo

Simplificações (todas comuns em modelos de estudo e explicadas no README):
  - dois valores de cp e gama: um para ar frio, outro para gás quente
  - o fan comprime igual o ar do bypass e o do núcleo
  - motor parado no chão (decolagem estática), sem sangria para o avião,
    que é a condição em que a ICAO e a ficha de certificação definem o empuxo
"""
from dataclasses import dataclass, replace

import numpy as np
from scipy.optimize import fsolve

# Propriedades dos gases (valores típicos de livro-texto)
CP_AR, GAMA_AR = 1004.5, 1.40      # ar frio (compressores)       [J/(kg·K)]
CP_GAS, GAMA_GAS = 1148.0, 1.333   # gás quente (câmara e turbinas)
PCI = 43.1e6                       # poder calorífico inferior do querosene Jet A [J/kg]

T_ISA, P_ISA = 288.15, 101325.0    # atmosfera padrão ao nível do mar [K, Pa]


@dataclass(frozen=True)
class Parametros:
    """Tudo o que descreve o motor. Os três primeiros vêm da ICAO; o resto são
    valores típicos da tecnologia dos anos 1990 (faixas de livro-texto)."""
    razao_bypass: float
    razao_pressao_global: float
    razao_pressao_fan: float = 1.6          # será calculada na calibração
    razao_pressao_hpc: float = 11.0         # HPC de 9 estágios (~1,3 por estágio)

    # Eficiências politrópicas: "qualidade aerodinâmica" de cada compressor
    eta_pol_fan: float = 0.90
    eta_pol_booster: float = 0.89
    eta_pol_hpc: float = 0.90
    # Eficiências isentrópicas das turbinas
    eta_hpt: float = 0.88
    eta_lpt: float = 0.91

    recuperacao_entrada: float = 0.995      # perda de pressão na entrada de ar
    perda_pressao_camara: float = 0.05      # a câmara perde ~5% da pressão
    eta_combustao: float = 0.999            # quase todo o combustível queima
    eta_mecanica: float = 0.99              # atrito nos mancais dos eixos
    refrigeracao_hpt: float = 0.15          # fração do ar do núcleo que resfria a HPT
    perda_duto_bypass: float = 0.98
    perda_duto_nucleo: float = 0.99
    coef_velocidade_bocal: float = 0.985

    # A sonda de EGT fica depois do 1º dos 4 estágios da LPT.
    # Supomos que os 4 estágios fazem trabalhos iguais: 1/4 antes da sonda.
    fracao_lpt_antes_egt: float = 0.25


def _expoente(gama: float) -> float:
    return (gama - 1) / gama


def _compressor(T_entrada, razao, eta_pol):
    """Temperatura de saída de um compressor usando a eficiência politrópica.
    Ideal (sem perdas): T2/T1 = razao^((γ-1)/γ). Com perdas, o expoente fica maior:
    o compressor esquenta mais o ar do que o necessário para aquela compressão."""
    return T_entrada * razao ** (_expoente(GAMA_AR) / eta_pol)


def _turbina(T_entrada, P_entrada, queda_T, eta_isen):
    """Dada a queda de temperatura que a turbina precisa produzir (para fornecer o
    trabalho pedido), calcula a pressão de saída. Turbina pior (eta menor) precisa
    de uma queda de pressão maior para entregar o mesmo trabalho."""
    T_saida_ideal = T_entrada - queda_T / eta_isen
    P_saida = P_entrada * (T_saida_ideal / T_entrada) ** (1 / _expoente(GAMA_GAS))
    return T_entrada - queda_T, P_saida


def _velocidade_bocal(T_total, P_total, P_ambiente, cp, gama, coef):
    """Velocidade do jato num bocal convergente. Se a razão de pressão passar do valor
    crítico, o bocal "engasga" (Mach 1 na saída) e sobra um empuxo de pressão.
    Devolve (velocidade, empuxo extra de pressão por kg/s de vazão)."""
    razao_critica = ((gama + 1) / 2) ** (gama / (gama - 1))
    if P_total <= P_ambiente:
        return 0.0, 0.0  # sem pressão sobrando, não há jato (evita raiz de número negativo)
    if P_total / P_ambiente <= razao_critica:
        v = coef * np.sqrt(2 * cp * T_total * (1 - (P_ambiente / P_total) ** _expoente(gama)))
        return v, 0.0
    # Bocal engasgado: Mach 1 na saída
    T_saida = T_total * 2 / (gama + 1)
    P_saida = P_total / razao_critica
    R = cp * _expoente(gama)
    v = coef * np.sqrt(gama * R * T_saida)
    densidade = P_saida / (R * T_saida)
    area_por_vazao = 1 / (densidade * v)
    return v, area_por_vazao * (P_saida - P_ambiente)


def ciclo(p: Parametros, vazao_nucleo, T4, T0=T_ISA, P0=P_ISA) -> dict:
    """Calcula o motor inteiro, estação por estação, para uma vazão de ar no núcleo
    [kg/s] e uma temperatura de saída da câmara T4 [K]."""
    s = {"T0": T0, "P0": P0}
    vazao_bypass = vazao_nucleo * p.razao_bypass
    vazao_total = vazao_nucleo + vazao_bypass

    # Entrada de ar e fan
    s["T2"], s["P2"] = T0, P0 * p.recuperacao_entrada
    s["T13"] = _compressor(s["T2"], p.razao_pressao_fan, p.eta_pol_fan)
    s["P13"] = s["P2"] * p.razao_pressao_fan

    # Booster (LPC): faz a compressão que falta entre o fan e o HPC
    razao_booster = p.razao_pressao_global / (p.razao_pressao_fan * p.razao_pressao_hpc)
    s["T25"] = _compressor(s["T13"], razao_booster, p.eta_pol_booster)
    s["P25"] = s["P13"] * razao_booster

    # HPC
    s["T3"] = _compressor(s["T25"], p.razao_pressao_hpc, p.eta_pol_hpc)
    s["P3"] = s["P2"] * p.razao_pressao_global

    # Câmara de combustão. Parte do ar do HPC desvia da câmara para resfriar a HPT.
    vazao_refrig = vazao_nucleo * p.refrigeracao_hpt
    vazao_camara = vazao_nucleo - vazao_refrig
    # Balanço de energia: energia do ar + energia do combustível = energia do gás quente
    combustivel = vazao_camara * (CP_GAS * T4 - CP_AR * s["T3"]) / (p.eta_combustao * PCI - CP_GAS * T4)
    s["T4"], s["P4"] = T4, s["P3"] * (1 - p.perda_pressao_camara)

    # HPT: precisa entregar exatamente o trabalho que o HPC consome
    trabalho_hpc = vazao_nucleo * CP_AR * (s["T3"] - s["T25"])
    vazao_rotor_hpt = vazao_camara + combustivel
    queda_hpt = trabalho_hpc / p.eta_mecanica / (vazao_rotor_hpt * CP_GAS)
    T45_antes_mistura, s["P45"] = _turbina(T4, s["P4"], queda_hpt, p.eta_hpt)
    # O ar de refrigeração (mais frio) se mistura ao gás depois da HPT
    vazao_lpt = vazao_rotor_hpt + vazao_refrig
    s["T45"] = (vazao_rotor_hpt * CP_GAS * T45_antes_mistura
                + vazao_refrig * CP_AR * s["T3"]) / (vazao_lpt * CP_GAS)

    # LPT: precisa entregar o trabalho do fan (todo o ar) e do booster (só o núcleo)
    trabalho_fan = vazao_total * CP_AR * (s["T13"] - s["T2"])
    trabalho_booster = vazao_nucleo * CP_AR * (s["T25"] - s["T13"])
    queda_lpt = (trabalho_fan + trabalho_booster) / p.eta_mecanica / (vazao_lpt * CP_GAS)
    s["T5"], s["P5"] = _turbina(s["T45"], s["P45"], queda_lpt, p.eta_lpt)

    # EGT: temperatura na sonda, depois do 1º estágio da LPT
    s["T49.5"] = s["T45"] - p.fracao_lpt_antes_egt * queda_lpt

    # Bocais e empuxo: empuxo = vazão × velocidade do jato (+ termo de pressão se engasgar)
    v18, extra18 = _velocidade_bocal(s["T13"], s["P13"] * p.perda_duto_bypass, P0,
                                     CP_AR, GAMA_AR, p.coef_velocidade_bocal)
    v8, extra8 = _velocidade_bocal(s["T5"], s["P5"] * p.perda_duto_nucleo, P0,
                                   CP_GAS, GAMA_GAS, p.coef_velocidade_bocal)
    empuxo_bypass = vazao_bypass * (v18 + extra18)
    empuxo_nucleo = vazao_lpt * (v8 + extra8)

    s.update({
        "vazao_nucleo": vazao_nucleo, "vazao_total": vazao_total, "combustivel": combustivel,
        "razao_booster": razao_booster, "v18": v18, "v8": v8,
        "empuxo": empuxo_bypass + empuxo_nucleo, "empuxo_bypass": empuxo_bypass,
        "egt_c": s["T49.5"] - 273.15,
    })
    return s


def com_ajuste(p: Parametros, delta_eta: float) -> Parametros:
    """Soma o mesmo valor a todas as eficiências de compressores e turbinas.

    É o nosso único "botão" de calibração: representa o quanto a tecnologia real do
    CFM56-7B é melhor (ou pior) que os valores típicos de livro-texto. Um botão só,
    em vez de vários, evita que o modelo "decore" os dados.
    """
    return replace(
        p,
        eta_pol_fan=p.eta_pol_fan + delta_eta,
        eta_pol_booster=p.eta_pol_booster + delta_eta,
        eta_pol_hpc=p.eta_pol_hpc + delta_eta,
        eta_hpt=p.eta_hpt + delta_eta,
        eta_lpt=p.eta_lpt + delta_eta,
    )


def calibrar(p: Parametros, empuxo_n, combustivel_kg_s, razao_velocidades=0.80):
    """Acha a T4, a razão de pressão do fan e a vazão de ar que fazem o modelo
    reproduzir o empuxo e o consumo medidos pela ICAO.

    Truque para resolver de forma estável: com T4 e razões de pressão fixas, dobrar a
    vazão de ar dobra o empuxo E o consumo. Ou seja, o consumo específico (TSFC) e a
    razão entre as velocidades dos jatos não dependem do tamanho do motor.
    Então resolvemos em duas partes:
      1. T4 e razão do fan, com 2 equações:
           - TSFC do modelo = TSFC da ICAO
           - velocidade do jato de bypass / velocidade do jato do núcleo = 0,80
             (regra de projeto de livro-texto: perto desse valor o motor gasta o mínimo
              de combustível, porque a energia é bem dividida entre os dois jatos)
      2. a vazão, por regra de três, para o empuxo bater com o da ICAO.
    """
    tsfc_alvo = combustivel_kg_s / empuxo_n
    VAZAO_REF = 50.0  # vazão qualquer; o resultado da parte 1 não depende dela

    def residuos(x):
        T4, rp_fan = x
        s = ciclo(replace(p, razao_pressao_fan=rp_fan), VAZAO_REF, T4)
        if s["empuxo"] <= 0 or s["v8"] <= 0:
            return [10.0, 10.0]  # região sem sentido físico: empurra o solver para fora
        return [s["combustivel"] / s["empuxo"] / tsfc_alvo - 1,
                s["v18"] / s["v8"] - razao_velocidades]

    (T4, rp_fan), info, ok, msg = fsolve(residuos, x0=[1700.0, 1.65], full_output=True)
    if ok != 1 or max(abs(r) for r in residuos([T4, rp_fan])) > 1e-6:
        raise RuntimeError(f"Calibração não convergiu: {msg}")

    p_calibrado = replace(p, razao_pressao_fan=rp_fan)
    referencia = ciclo(p_calibrado, VAZAO_REF, T4)
    vazao_nucleo = VAZAO_REF * empuxo_n / referencia["empuxo"]  # regra de três
    return p_calibrado, ciclo(p_calibrado, vazao_nucleo, T4)


def dia_quente(estado_isa: dict, T0: float) -> dict:
    """Leva o ponto de decolagem do dia padrão (15 °C) para um dia mais quente,
    mantendo o mesmo empuxo (o motor é "flat rated": o FADEC segura o empuxo até 30 °C).

    Pela análise de semelhança (parâmetros corrigidos), o motor opera no mesmo ponto
    "corrigido": todas as temperaturas se multiplicam por θ = T0 / 288,15, a vazão
    física cai com 1/√θ, as velocidades sobem com √θ, e o empuxo (vazão × velocidade)
    fica igual. É a mesma ideia da "EGT corrigida" usada no monitoramento de motores.
    """
    theta = T0 / T_ISA
    quente = dict(estado_isa)
    for chave in ["T0", "T2", "T13", "T25", "T3", "T4", "T45", "T49.5", "T5"]:
        quente[chave] = estado_isa[chave] * theta
    quente["egt_c"] = quente["T49.5"] - 273.15
    quente["vazao_total"] = estado_isa["vazao_total"] / np.sqrt(theta)
    quente["theta"] = theta
    return quente
