"""Etapa 3: desgaste do motor e queda da margem de EGT ao longo dos ciclos.

Duas partes:

A) Física (modelo da etapa 2): "taxas de troca"
   Quanto a EGT, a T4 e o consumo sobem quando cada componente perde 1 ponto de
   eficiência, mantendo o empuxo (o FADEC segura a rotação N1 para entregar o empuxo
   pedido, então o motor desgastado precisa queimar mais combustível).
   Na indústria, essa tabela é a base da "análise de caminho do gás" (gas path
   analysis): olhando quanto a EGT, o consumo e as rotações mudaram, dá para
   estimar qual componente se desgastou.

B) Desgaste ao longo dos ciclos (dados publicados) e validação
   Curva de perda de margem (desgaste.py) ajustada às taxas publicadas.
   Prevemos quantos ciclos cada versão fica na asa até a margem acabar e comparamos
   com os intervalos que a TAP M&E relatou à Aircraft Commerce (nº 58, 2008).

Como rodar:  .venv/bin/python src/03_desgaste.py
"""
import sqlite3
from dataclasses import replace
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.optimize import brentq

from desgaste import NOMINAL, OTIMISTA, PESSIMISTA
from motor import Parametros, calibrar, ciclo, com_ajuste

RAIZ = Path(__file__).resolve().parent.parent
BANCO = RAIZ / "dados" / "cfm56.db"
FIGURAS = RAIZ / "docs" / "figuras"

# Intervalos na asa relatados pela TAP M&E (Aircraft Commerce nº 58), com as margens
# iniciais que a própria fonte usou no cálculo. Só há taxas publicadas para estas 3 versões.
PRIMEIRA_VIDA = pd.DataFrame([
    # motor,        margem nova usada pela fonte, intervalo publicado (min, max)
    ("CFM56-7B24", 100, 17_000, 18_000),
    ("CFM56-7B26",  80, 12_000, 14_000),
    ("CFM56-7B27",  60, 10_000, 12_000),
], columns=["motor", "margem_nova_fonte", "intervalo_pub_min", "intervalo_pub_max"])

# Depois da revisão: margem restaurada a 70–80% da nova (mesma fonte, tabela de margens
# restauradas) e intervalos publicados para a "segunda vida e seguintes".
SEGUNDA_VIDA = pd.DataFrame([
    ("CFM56-7B24", 70, 80, 12_000, 13_000),
    ("CFM56-7B26", 42, 48,  9_000, 12_000),
    ("CFM56-7B27", 40, 45,  8_000, 10_000),
], columns=["motor", "restaurada_min", "restaurada_max", "intervalo_pub_min", "intervalo_pub_max"])

AZUL, LARANJA, VERDE_AZULADO = "#2a78d6", "#eb6834", "#1baf7a"
CINZA, TEXTO, TEXTO_2, FUNDO = "#b5b3ad", "#0b0b0b", "#52514e", "#fcfcfb"
plt.rcParams.update({
    "figure.facecolor": FUNDO, "axes.facecolor": FUNDO, "axes.edgecolor": CINZA,
    "axes.labelcolor": TEXTO_2, "xtick.color": TEXTO_2, "ytick.color": TEXTO_2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": "#e6e5e0", "grid.linewidth": 0.6, "axes.axisbelow": True, "font.size": 9,
})


# ---------------------------------------------------------------- A) física

def taxas_de_troca() -> pd.DataFrame:
    """Perde 1 ponto de eficiência em cada componente do 7B24 e mede o efeito,
    mantendo o empuxo e a vazão de ar (o fan continua na mesma rotação)."""
    with sqlite3.connect(BANCO) as con:
        v = pd.read_sql("SELECT * FROM icao_cfm56_7b WHERE motor = 'CFM56-7B24'", con).iloc[0]
    # Mesmas hipóteses da etapa 2
    base = com_ajuste(Parametros(v.razao_bypass, v.razao_pressao, refrigeracao_hpt=0.07), 0.03)
    p, novo = calibrar(base, v.empuxo_kn * 1000, v.consumo_decolagem_kg_s)

    componentes = {
        "HPC (compressor de alta)": "eta_pol_hpc",
        "HPT (turbina de alta)": "eta_hpt",
        "Fan": "eta_pol_fan",
        "Booster (compressor de baixa)": "eta_pol_booster",
        "LPT (turbina de baixa)": "eta_lpt",
    }
    linhas = []
    for nome, campo in componentes.items():
        gasto = replace(p, **{campo: getattr(p, campo) - 0.01})
        # Acha a T4 que devolve o mesmo empuxo com o componente desgastado
        T4 = brentq(lambda T: ciclo(gasto, novo["vazao_nucleo"], T)["empuxo"] - novo["empuxo"], 1000, 2500)
        d = ciclo(gasto, novo["vazao_nucleo"], T4)
        linhas.append({
            "componente": nome,
            "delta_egt_c": d["egt_c"] - novo["egt_c"],
            "delta_t4_k": T4 - novo["T4"],
            "delta_consumo_pct": (d["combustivel"] / novo["combustivel"] - 1) * 100,
        })
    return pd.DataFrame(linhas)


# ------------------------------------------------- B) desgaste e validação

def validar_primeira_vida(margens_modelo: dict) -> pd.DataFrame:
    df = PRIMEIRA_VIDA.copy()
    df["previsto_nominal"] = [NOMINAL.ciclos_ate(m) for m in df["margem_nova_fonte"]]
    df["previsto_pessimista"] = [PESSIMISTA.ciclos_ate(m) for m in df["margem_nova_fonte"]]
    df["previsto_otimista"] = [OTIMISTA.ciclos_ate(m) for m in df["margem_nova_fonte"]]
    # Cadeia completa: margem prevista pela física (etapa 2) em vez da margem da fonte
    df["margem_nova_modelo"] = df["motor"].map(margens_modelo)
    df["previsto_cadeia_completa"] = [NOMINAL.ciclos_ate(m) for m in df["margem_nova_modelo"]]
    df["publicado_dentro_da_faixa_prevista"] = (
        (df["intervalo_pub_max"] >= df["previsto_pessimista"]) & (df["intervalo_pub_min"] <= df["previsto_otimista"])
    )
    return df


def validar_segunda_vida() -> pd.DataFrame:
    """Depois da revisão, as taxas de perda são parecidas com as de motor novo
    (inclusive o amaciamento), segundo a mesma fonte."""
    df = SEGUNDA_VIDA.copy()
    media = (df["restaurada_min"] + df["restaurada_max"]) / 2
    df["previsto_nominal"] = [NOMINAL.ciclos_ate(m) for m in media]
    df["previsto_pessimista"] = [PESSIMISTA.ciclos_ate(m) for m in df["restaurada_min"]]
    df["previsto_otimista"] = [OTIMISTA.ciclos_ate(m) for m in df["restaurada_max"]]
    df["publicado_dentro_da_faixa_prevista"] = (
        (df["intervalo_pub_max"] >= df["previsto_pessimista"]) & (df["intervalo_pub_min"] <= df["previsto_otimista"])
    )
    return df


def figura_margens(primeira: pd.DataFrame) -> Path:
    fig, eixo = plt.subplots(figsize=(9, 5))
    efc = np.linspace(0, 26_000, 400)
    cores = [AZUL, VERDE_AZULADO, LARANJA]
    for (_, v), cor in zip(primeira.iterrows(), cores):
        nome = v.motor.replace("CFM56-", "")
        m0 = v.margem_nova_fonte
        # Abaixo de zero o motor já teria ido para a oficina: cortamos as curvas ali
        pess, otim, nom = (np.clip(c.margem(m0, efc), 0, None) for c in (PESSIMISTA, OTIMISTA, NOMINAL))
        eixo.fill_between(efc, pess, otim, where=otim > 0, color=cor, alpha=0.15, linewidth=0)
        eixo.plot(efc[nom > 0], nom[nom > 0], color=cor, linewidth=2)
        eixo.annotate(nome, (300, m0), textcoords="offset points", xytext=(0, 6), color=TEXTO, fontsize=9)
        # Intervalo publicado: barra horizontal sobre a linha de margem zero
        eixo.hlines(-4 - 4 * list(primeira.motor).index(v.motor), v.intervalo_pub_min, v.intervalo_pub_max,
                    color=cor, linewidth=6)
    eixo.axhline(0, color=TEXTO_2, linewidth=1)
    eixo.text(26_000, 2, "margem zero: hora da revisão", ha="right", fontsize=8, color=TEXTO_2)
    eixo.text(200, -9, "barras abaixo do zero: intervalo na asa\nrelatado pela TAP M&E (mesma cor)",
              ha="left", va="center", fontsize=8, color=TEXTO_2)
    eixo.set_xlim(0, 26_000)
    eixo.set_ylim(-18, 110)
    eixo.set_xlabel("ciclos de voo desde novo (EFC)")
    eixo.set_ylabel("margem de EGT (°C)")
    eixo.set_title("Margem de EGT caindo com o desgaste (primeira vida na asa)\n"
                   "linha = taxas nominais publicadas · faixa sombreada = mínimo e máximo das fontes",
                   loc="left", fontsize=10, color=TEXTO)
    fig.tight_layout()
    caminho = FIGURAS / "03_margem_egt_ao_longo_dos_ciclos.png"
    fig.savefig(caminho, dpi=130)
    plt.close(fig)
    return caminho


def main() -> None:
    FIGURAS.mkdir(parents=True, exist_ok=True)

    print("A) Taxas de troca no CFM56-7B24 (−1 ponto de eficiência, mesmo empuxo):")
    troca = taxas_de_troca()
    print(troca.round(2).to_string(index=False))
    media = troca[troca["componente"].str.startswith(("HPC", "HPT"))]["delta_egt_c"].mean()
    print(f"\nO amaciamento (~{NOMINAL.amaciamento:.0f} °C de margem) equivale a perder "
          f"~{NOMINAL.amaciamento / media:.1f} pontos de eficiência somando HPC e HPT.")

    with sqlite3.connect(BANCO) as con:
        etapa2 = pd.read_sql("SELECT motor, margem_prevista_c FROM modelo_ciclo", con)
    margens_modelo = dict(zip(etapa2["motor"], etapa2["margem_prevista_c"]))

    print(f"\nB) Curva de desgaste nominal: amaciamento A = {NOMINAL.amaciamento:.1f} °C, "
          f"τ = {NOMINAL.tau:.0f} EFC, taxa madura = {NOMINAL.taxa_madura:.1f} °C por 1.000 EFC")

    primeira = validar_primeira_vida(margens_modelo)
    print("\nPrimeira vida na asa (EFC até a margem zerar):")
    print(primeira[["motor", "margem_nova_fonte", "intervalo_pub_min", "intervalo_pub_max", "previsto_pessimista",
                    "previsto_nominal", "previsto_otimista", "publicado_dentro_da_faixa_prevista"]]
          .round(0).to_string(index=False))
    print("\nCadeia completa (margem nova prevista pela física da etapa 2 → intervalo):")
    print(primeira[["motor", "margem_nova_modelo", "previsto_cadeia_completa", "intervalo_pub_min",
                    "intervalo_pub_max"]].round(0).to_string(index=False))

    segunda = validar_segunda_vida()
    print("\nSegunda vida (depois da revisão, margem restaurada a 70–80%):")
    print(segunda[["motor", "restaurada_min", "restaurada_max", "intervalo_pub_min", "intervalo_pub_max",
                   "previsto_pessimista", "previsto_nominal", "previsto_otimista",
                   "publicado_dentro_da_faixa_prevista"]].round(0).to_string(index=False))

    # Verificação cruzada: o nº 87 (2013, Lufthansa Technik/outros) dá margem restaurada de
    # 60–68 °C para o 7B26, bem acima dos 42–48 °C da tabela do nº 58.
    cruz_min, cruz_max = PESSIMISTA.ciclos_ate(60), OTIMISTA.ciclos_ate(68)
    print(f"\nVerificação cruzada 7B26 com margem restaurada de 60–68 °C (Aircraft Commerce nº 87): "
          f"{NOMINAL.ciclos_ate(64):,.0f} EFC nominal (faixa {cruz_min:,.0f}–{cruz_max:,.0f}) "
          f"contra 9.000–12.000 publicados")

    with sqlite3.connect(BANCO) as con:
        troca.to_sql("taxas_de_troca", con, if_exists="replace", index=False)
        primeira.to_sql("intervalos_primeira_vida", con, if_exists="replace", index=False)
        segunda.to_sql("intervalos_segunda_vida", con, if_exists="replace", index=False)
    print(f"\nFigura: {figura_margens(primeira)}")


if __name__ == "__main__":
    main()
