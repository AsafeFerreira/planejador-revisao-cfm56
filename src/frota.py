"""Frota fictícia de motores CFM56-7B e simulador mês a mês das revisões (shop visits).

TUDO AQUI É SIMULADO. A frota, os aviões e os motores são inventados. Não há nenhum
dado da GE, da CFM ou da Celma. Os parâmetros vêm de fontes públicas:
  - Aircraft Commerce nº 58 (2008) e nº 87 (2013): margens de EGT, utilização,
    vidas e preços de lista das LLPs.
  - Etapa 3 deste projeto: a curva de perda de margem (desgaste.py).

O que tira um motor da asa (os dois "relógios" do motor):
  1) Margem de EGT: cai a cada ciclo. Quando chega a zero, o motor não consegue mais
     dar o empuxo de decolagem num dia quente sem passar do limite de temperatura.
  2) LLPs (life limited parts): discos e eixos que giram e podem estourar se tiverem
     trincas de fadiga. Têm vida máxima certificada em ciclos. Ao chegar ao limite,
     a peça tem que sair, não importa o estado do motor.
O motor sai pelo relógio que vencer primeiro.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from desgaste import NOMINAL, Desgaste

VERSOES = ["CFM56-7B24", "CFM56-7B26", "CFM56-7B27"]  # só há taxas de desgaste publicadas para estas

# Margem de EGT (°C) de motor novo, faixa publicada (Aircraft Commerce nº 58 e 87)
MARGEM_NOVA = {0: (100, 105), 1: (80, 85), 2: (52, 60)}
# Margem depois da revisão: 7B24 e 7B27 da AC58; 7B26 da AC87 (60–68), porque o
# valor da AC58 (42–48) é incompatível com os intervalos do próprio artigo (etapa 3)
MARGEM_RESTAURADA = {0: (70, 80), 1: (60, 68), 2: (40, 45)}

# LLPs agrupadas por módulo (padrão Tech Insertion, Aircraft Commerce nº 58 e 87).
# Uma peça de um grupo vencida já obriga a revisão; por simplicidade, o grupo inteiro
# tem a mesma vida (na prática, cada uma das 18 peças tem a sua).
GRUPOS_LLP = ["Fan/booster", "Núcleo (HPC+HPT)", "LPT"]
VIDA_LLP = np.array([30_000, 20_000, 25_000])           # EFC
PRECO_LLP = np.array([511_000, 1_304_000, 706_000])     # US$, preço de lista 2013 (AC87)
CUSTO_POR_CICLO = PRECO_LLP / VIDA_LLP                  # US$ por EFC: quanto cada ciclo "gasta" da peça

# Utilização (AC58): 3.000–3.200 horas de voo por ano, 1,9 h por ciclo em média.
HORAS_ANO = (3_000, 3_200)
HORAS_POR_CICLO = (1.5, 2.5)

MARGEM_MINIMA = 0.0   # °C: remove quando a margem acaba (mesmo critério da etapa 3)
TAT_MESES = 2         # tempo do motor dentro da oficina. HIPÓTESE: não está nas fontes usadas
# Custo de uma revisão sem as LLPs: "core performance restoration" de US$ 1,6–1,85 milhão
# (AC87, 2013; mão de obra + materiais). Usamos o meio da faixa para toda revisão.
CUSTO_REVISAO = 1_725_000
STUB_MINIMO = 5_000   # EFC: na política "stub mínimo", troca a LLP se sobrar menos que isso

NA_ASA, NA_FILA, NA_OFICINA = 0, 1, 2

# Quantos EFC se espera que o motor fique na asa depois de uma revisão (cenário nominal,
# margem restaurada média). É a conta que o planejador faz para decidir o que trocar.
INTERVALO_PLANEJADO = {v: NOMINAL.ciclos_ate(np.mean(MARGEM_RESTAURADA[v])) for v in MARGEM_RESTAURADA}


@dataclass
class Estado:
    """Fotografia da frota num mês. Cada vetor tem uma posição por motor."""
    versao: np.ndarray       # índice em VERSOES
    util: np.ndarray         # EFC voados por mês
    entrega: np.ndarray      # mês em que o motor começou a voar (negativo = no passado)
    margem_ini: np.ndarray   # margem de EGT no início da vida atual (nova ou restaurada)
    efc_vida: np.ndarray     # EFC desde a última revisão (ou desde novo)
    efc_total: np.ndarray    # EFC desde novo
    llp: np.ndarray          # (motores × 3) vida restante de cada grupo de LLP
    status: np.ndarray       # NA_ASA, NA_FILA ou NA_OFICINA
    retorno: np.ndarray      # mês em que sai da oficina
    revisoes: np.ndarray     # quantas revisões já fez
    fila: List[int] = field(default_factory=list)  # ordem de chegada na fila da oficina
    removidos: Dict[int, dict] = field(default_factory=dict)  # dados da remoção, até entrar na oficina

    def copia(self) -> "Estado":
        return Estado(**{k: v.copy() for k, v in vars(self).items()})


def criar_frota(n_avioes: int = 50, semente: int = 42):
    """Inventa uma companhia aérea com 50 aviões 737NG (100 motores).

    Recebeu os aviões em dois lotes, como costuma acontecer: um há 9–12 anos e outro
    há 2–5 anos. Os dois motores de um avião são da mesma versão e voam o mesmo tanto.
    Devolve o estado "de fábrica" (antes de voar) e o desgaste real de cada motor,
    que o planejador não conhece (ele só vê a margem atual)."""
    rng = np.random.default_rng(semente)
    lote1 = int(n_avioes * 0.6)
    entrega_aviao = np.concatenate([rng.integers(-144, -108, lote1),
                                    rng.integers(-60, -24, n_avioes - lote1)])
    # mistura fixa de versões: 50% 7B24, 36% 7B26, 14% 7B27, em ordem aleatória
    versao_aviao = rng.permutation(np.repeat([0, 1, 2], [n_avioes // 2, round(n_avioes * 0.36),
                                                       n_avioes - n_avioes // 2 - round(n_avioes * 0.36)]))
    util_aviao = rng.uniform(*HORAS_ANO, n_avioes) / 12 / rng.uniform(*HORAS_POR_CICLO, n_avioes)

    # cada avião vira dois motores
    versao, entrega, util = (np.repeat(x, 2) for x in (versao_aviao, entrega_aviao, util_aviao))
    n = len(versao)
    margem_nova = np.array([rng.uniform(*MARGEM_NOVA[v]) for v in versao])
    estado = Estado(versao=versao, util=util, entrega=entrega, margem_ini=margem_nova,
                    efc_vida=np.zeros(n), efc_total=np.zeros(n),
                    llp=np.tile(VIDA_LLP, (n, 1)).astype(float),
                    status=np.full(n, NA_ASA), retorno=np.zeros(n, dtype=int),
                    revisoes=np.zeros(n, dtype=int))
    desgaste_real = sortear_desgaste(n, rng)
    cadastro = pd.DataFrame({"motor": [f"M{i + 1:03d}" for i in range(n)],
                             "aviao": [f"AV-{i // 2 + 1:02d}" for i in range(n)],
                             "versao": [VERSOES[v] for v in versao]})
    return estado, desgaste_real, cadastro


def sortear_desgaste(n: int, rng) -> Desgaste:
    """Um ritmo de desgaste para cada motor, dentro das faixas publicadas (11–15 °C no
    1º milhar de ciclos e 4–6 °C/1.000 depois). Motores iguais desgastam diferente
    (rotas, poeira, lavagens, derate)."""
    return Desgaste(perda_1000_efc=rng.uniform(11, 15, n), taxa_madura=rng.uniform(4, 6, n))


def reancorar(estado: Estado, desgaste_antigo: Desgaste, desgaste_novo: Desgaste) -> Estado:
    """Troca o ritmo de desgaste sem mudar a margem de hoje.

    O planejador sabe a margem atual de cada motor (vem do monitoramento de tendência),
    mas não sabe o ritmo futuro. Ao sortear um ritmo novo, ajustamos a margem do início
    da vida para que margem_ini − perda_nova(efc_vida) continue igual à margem de hoje."""
    e = estado.copia()
    margem_hoje = e.margem_ini - desgaste_antigo.perda(e.efc_vida)
    e.margem_ini = margem_hoje + desgaste_novo.perda(e.efc_vida)
    return e


def _revisar(e: Estado, i: int, mes: int, politica: str, rng, sortear: bool, tat: int) -> dict:
    """O que acontece quando o motor entra na oficina (o "workscope").

    Decisão das LLPs: trocar agora ou deixar o resto da vida (o "stub") para depois?
      - "stub_minimo": troca só se sobrar menos que STUB_MINIMO ciclos.
      - "casada": troca se a peça não aguentar até a próxima remoção por EGT. Assim a
        próxima revisão acontece pela EGT e não por uma LLP que venceu no meio do caminho.
    Trocar cedo joga fora a vida que sobrou (desperdício); trocar tarde força uma
    revisão extra. Esse é o equilíbrio que o planejamento busca."""
    v = e.versao[i]
    limiar = STUB_MINIMO if politica == "stub_minimo" else INTERVALO_PLANEJADO[v]
    troca = e.llp[i] < limiar
    sobra = np.where(troca, np.maximum(e.llp[i], 0), 0)
    registro = {"motor": i, "entrada": mes,
                "llps_trocadas": ", ".join(g for g, t in zip(GRUPOS_LLP, troca) if t) or "nenhuma",
                "gasto_llp_usd": PRECO_LLP[troca].sum(),
                "desperdicio_usd": (sobra * CUSTO_POR_CICLO).sum()}
    e.llp[i, troca] = VIDA_LLP[troca]
    lo, hi = MARGEM_RESTAURADA[v]
    e.margem_ini[i] = rng.uniform(lo, hi) if sortear else (lo + hi) / 2
    e.efc_vida[i] = 0
    e.status[i] = NA_OFICINA
    e.retorno[i] = mes + tat
    e.revisoes[i] += 1
    return registro


def simular(estado: Estado, mes_inicial: int, n_meses: int, desgaste: Desgaste, rng,
            politica: str = "casada", capacidade: Optional[int] = None,
            tat: int = TAT_MESES, sortear: bool = True):
    """Avança a frota mês a mês. Em cada mês:
      1) motores que terminaram a revisão voltam para a asa;
      2) cada motor na asa voa o seu mês; se a margem ou uma LLP for acabar neste mês,
         ele é removido antes (a oficina não deixa passar do limite);
      3) removidos entram na fila; a oficina recebe até `capacidade` por mês, por ordem
         de chegada (None = sem limite).
    Enquanto o motor está fora da asa, um motor reserva voa no lugar dele.
    Devolve o estado final, a lista de revisões e um resumo por mês."""
    e = estado.copia()
    revisoes, resumo = [], []
    for m in range(mes_inicial, mes_inicial + n_meses):
        e.status[(e.status == NA_OFICINA) & (e.retorno <= m)] = NA_ASA

        voando = (e.status == NA_ASA) & (e.entrega <= m)
        margem_agora = e.margem_ini - desgaste.perda(e.efc_vida)
        efc_fim = e.efc_vida + e.util
        margem_fim = e.margem_ini - desgaste.perda(efc_fim)
        llp_fim = e.llp - e.util[:, None]
        por_egt = voando & (margem_fim <= MARGEM_MINIMA)
        por_llp = voando & (llp_fim <= 0).any(axis=1)
        sai = por_egt | por_llp
        segue = voando & ~sai
        e.efc_vida[segue] = efc_fim[segue]
        e.efc_total[segue] += e.util[segue]
        e.llp[segue] = llp_fim[segue]

        for i in np.flatnonzero(sai):
            causa = "EGT + LLP" if por_egt[i] and por_llp[i] else ("EGT" if por_egt[i] else "LLP")
            e.removidos[i] = {"remocao": m, "causa": causa, "margem_na_remocao": margem_agora[i],
                          "efc_na_asa": e.efc_vida[i], "efc_total": e.efc_total[i]}
            e.status[i] = NA_FILA
            e.fila.append(i)

        vagas = len(e.fila) if capacidade is None else capacidade
        entram, e.fila = e.fila[:vagas], e.fila[vagas:]
        for i in entram:
            reg = _revisar(e, i, m, politica, rng, sortear, tat)
            reg.update(e.removidos.pop(i))
            reg["espera_meses"] = m - reg["remocao"]
            revisoes.append(reg)

        resumo.append({"mes": m, "remocoes": int(sai.sum()),
                       "por_egt": int((por_egt & ~por_llp).sum()), "por_llp": int((por_llp & ~por_egt).sum()),
                       "por_ambos": int((por_egt & por_llp).sum()), "entradas": len(entram),
                       "na_fila": len(e.fila), "na_oficina": int((e.status == NA_OFICINA).sum())})
    resumo = pd.DataFrame(resumo)
    resumo["fora_da_asa"] = resumo.na_fila + resumo.na_oficina  # = motores reserva necessários
    return e, pd.DataFrame(revisoes), resumo
