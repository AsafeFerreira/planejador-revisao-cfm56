"""Etapa 2: calibra o modelo termodinâmico com dados públicos e valida a margem de EGT.

Dados de entrada (todos públicos):
  - ICAO (etapa 1): empuxo, razão de bypass, razão de pressão e consumo na decolagem
  - Ficha de certificação UK.TC.E.00104 (CAA, 2024): EGT medida na estação T49.5,
    limite de 950 °C exibido na cabine
  - Aircraft Commerce nº 58 (2008) e nº 87 (2013): limite de EGT "real" de cada versão,
    corner point de 30 °C e margem de EGT de motores novos

Método:
  1. Para cada uma das 6 versões, o modelo acha a T4, a razão de pressão do fan e a
     vazão de ar que reproduzem o empuxo e o consumo da ICAO.
  2. Levamos o ponto de decolagem para um dia de 30 °C (o "corner point": acima disso
     o FADEC reduz o empuxo). É nessa condição que a margem de EGT é definida.
  3. Calibração: um único deslocamento de EGT, calculado só com o 7B24.
  4. Validação: com esse mesmo deslocamento, o modelo prevê a margem das outras
     5 versões, e comparamos com os valores publicados (que o modelo não viu).

Saídas: tabela modelo_ciclo em dados/cfm56.db e duas figuras em docs/figuras/.
Como rodar:  .venv/bin/python src/02_modelo_ciclo.py
"""
import sqlite3
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from motor import Parametros, calibrar, com_ajuste, dia_quente

RAIZ = Path(__file__).resolve().parent.parent
BANCO = RAIZ / "dados" / "cfm56.db"
FIGURAS = RAIZ / "docs" / "figuras"

CORNER_POINT_C = 30.0      # Aircraft Commerce nº 87: corner point de 30 °C nas 5 versões principais
AJUSTE_EFICIENCIA = 0.03   # componentes 3 pontos melhores que os valores de livro-texto
REFRIGERACAO = 0.07        # ar de refrigeração que passa por fora do rotor da HPT
VERSAO_CALIBRACAO = "CFM56-7B24"

# Limite de EGT "real" (medido, sem o shunt da cabine) e margem de EGT de motor novo.
# Fontes: Aircraft Commerce nº 58 (tabela de especificações e texto) e nº 87 (entrevistas
# com oficinas). Quando as fontes divergem, usamos a faixa que cobre as duas.
PUBLICADO = pd.DataFrame([
    # motor,        limite_real, margem_min, margem_max
    ("CFM56-7B18",  857, 125, 130),
    ("CFM56-7B20",  884, 125, 135),
    ("CFM56-7B22",  886, 103, 110),
    ("CFM56-7B24",  908, 100, 105),
    ("CFM56-7B26",  920,  80,  85),
    ("CFM56-7B27",  920,  52,  60),
], columns=["motor", "limite_egt_real_c", "margem_pub_min", "margem_pub_max"])

AZUL, LARANJA, CINZA = "#2a78d6", "#eb6834", "#b5b3ad"
TEXTO, TEXTO_2, FUNDO = "#0b0b0b", "#52514e", "#fcfcfb"
plt.rcParams.update({
    "figure.facecolor": FUNDO, "axes.facecolor": FUNDO, "axes.edgecolor": CINZA,
    "axes.labelcolor": TEXTO_2, "xtick.color": TEXTO_2, "ytick.color": TEXTO_2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": "#e6e5e0", "grid.linewidth": 0.6, "axes.axisbelow": True, "font.size": 9,
})


def versoes_originais() -> pd.DataFrame:
    with sqlite3.connect(BANCO) as con:
        icao = pd.read_sql("SELECT * FROM icao_cfm56_7b WHERE geracao = 'Original'", con)
    return icao.merge(PUBLICADO, on="motor")


def rodar_modelo(icao: pd.DataFrame, ajuste=AJUSTE_EFICIENCIA, refrigeracao=REFRIGERACAO) -> pd.DataFrame:
    linhas = []
    for _, v in icao.iterrows():
        base = com_ajuste(Parametros(v.razao_bypass, v.razao_pressao, refrigeracao_hpt=refrigeracao), ajuste)
        p, isa = calibrar(base, v.empuxo_kn * 1000, v.consumo_decolagem_kg_s)
        quente = dia_quente(isa, CORNER_POINT_C + 273.15)
        linhas.append({
            "motor": v.motor,
            "vazao_ar_kg_s": isa["vazao_total"],
            "razao_pressao_fan": p.razao_pressao_fan,
            "razao_pressao_booster": isa["razao_booster"],
            "T3_c": isa["T3"] - 273.15,
            "T4_k": isa["T4"],
            "T45_c": isa["T45"] - 273.15,
            "egt_isa_modelo_c": isa["egt_c"],
            "egt_30c_modelo_c": quente["egt_c"],
            "estado_isa": isa,
        })
    return pd.DataFrame(linhas)


def validar(icao: pd.DataFrame, modelo: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    df = icao[["motor", "limite_egt_real_c", "margem_pub_min", "margem_pub_max"]].merge(modelo, on="motor")
    df["margem_pub_media"] = (df["margem_pub_min"] + df["margem_pub_max"]) / 2
    # EGT "real" de um motor novo a 30 °C, deduzida das fontes: limite − margem publicada
    df["egt_30c_publicada_c"] = df["limite_egt_real_c"] - df["margem_pub_media"]

    # Calibração com UMA versão: diferença entre o publicado e o modelo no 7B24
    ref = df.set_index("motor").loc[VERSAO_CALIBRACAO]
    deslocamento = ref["egt_30c_publicada_c"] - ref["egt_30c_modelo_c"]

    df["egt_30c_prevista_c"] = df["egt_30c_modelo_c"] + deslocamento
    df["margem_prevista_c"] = df["limite_egt_real_c"] - df["egt_30c_prevista_c"]
    df["erro_c"] = df["margem_prevista_c"] - df["margem_pub_media"]
    df["dentro_da_faixa"] = df["margem_prevista_c"].between(df["margem_pub_min"] - 5, df["margem_pub_max"] + 5)
    return df, deslocamento


def sensibilidade(icao: pd.DataFrame) -> pd.DataFrame:
    """Repete a validação com outras hipóteses, para mostrar que a conclusão não
    depende da escolha exata do ajuste de eficiência e da refrigeração."""
    linhas = []
    for refrigeracao in [0.07, 0.10]:
        for ajuste in [0.02, 0.03, 0.04]:
            try:
                df, _ = validar(icao, rodar_modelo(icao, ajuste, refrigeracao))
            except RuntimeError:
                continue  # combinação sem solução física para alguma versão
            teste = df[df["motor"] != VERSAO_CALIBRACAO]
            linhas.append({"refrigeracao": refrigeracao, "ajuste_eficiencia": ajuste,
                           "erro_medio_abs_c": teste["erro_c"].abs().mean(),
                           "pior_erro_c": teste["erro_c"].abs().max()})
    return pd.DataFrame(linhas)


def figura_perfil(estado: dict) -> Path:
    """Temperatura do gás ao longo do motor (7B24, decolagem, dia padrão)."""
    estacoes = [("2", "entrada\ndo fan"), ("13", "saída\ndo fan"), ("25", "saída do\nbooster"),
                ("3", "saída\ndo HPC"), ("4", "saída da\ncâmara"), ("45", "saída\nda HPT"),
                ("49.5", "sonda\nde EGT"), ("5", "saída\nda LPT")]
    temps = [estado[f"T{e}"] - 273.15 for e, _ in estacoes]
    fig, eixo = plt.subplots(figsize=(9, 4.2))
    eixo.plot(range(len(temps)), temps, color=AZUL, linewidth=2, marker="o", markersize=8,
              markeredgecolor=FUNDO, markeredgewidth=2)
    for i, t in enumerate(temps):
        eixo.annotate(f"{t:.0f} °C", (i, t), textcoords="offset points", xytext=(0, 10),
                      ha="center", fontsize=8, color=TEXTO_2)
    i_egt = [e for e, _ in estacoes].index("49.5")
    eixo.plot(i_egt, temps[i_egt], marker="o", markersize=11, color=LARANJA,
              markeredgecolor=FUNDO, markeredgewidth=2)
    eixo.set_xticks(range(len(temps)), [f"{e}\n{n}" for e, n in estacoes], fontsize=7.5)
    eixo.set_ylabel("temperatura total (°C)")
    eixo.set_ylim(0, max(temps) * 1.15)
    eixo.set_title("CFM56-7B24 no modelo: temperatura ao longo do motor na decolagem (15 °C, nível do mar)\n"
                   "laranja = estação T49.5, onde a EGT é medida · modelo calibrado com dados públicos da ICAO",
                   loc="left", fontsize=10, color=TEXTO)
    fig.tight_layout()
    caminho = FIGURAS / "01_perfil_temperatura_7B24.png"
    fig.savefig(caminho, dpi=130)
    plt.close(fig)
    return caminho


def figura_validacao(df: pd.DataFrame) -> Path:
    """Margem de EGT de motor novo: faixa publicada x previsão do modelo."""
    fig, eixo = plt.subplots(figsize=(8, 4.5))
    x = range(len(df))
    nomes = df["motor"].str.replace("CFM56-", "")
    eixo.vlines(x, df["margem_pub_min"], df["margem_pub_max"], color=CINZA, linewidth=10,
                label="faixa publicada (Aircraft Commerce)")
    teste = df["motor"] != VERSAO_CALIBRACAO
    eixo.scatter([i for i, t in zip(x, teste) if t], df.loc[teste, "margem_prevista_c"], s=70,
                 color=AZUL, edgecolor=FUNDO, linewidth=2, zorder=3, label="previsão do modelo (validação)")
    eixo.scatter([i for i, t in zip(x, teste) if not t], df.loc[~teste, "margem_prevista_c"], s=70,
                 color=LARANJA, edgecolor=FUNDO, linewidth=2, zorder=3, label="versão usada na calibração")
    for i, v in zip(x, df["margem_prevista_c"]):
        eixo.annotate(f"{v:.0f}", (i, v), textcoords="offset points", xytext=(12, -3), fontsize=8, color=TEXTO_2)
    eixo.set_xticks(list(x), nomes)
    eixo.set_ylabel("margem de EGT de motor novo (°C)")
    eixo.set_ylim(0, 160)
    eixo.legend(loc="upper right", frameon=False)
    eixo.set_title("Margem de EGT a 30 °C: modelo físico x valores publicados\n"
                   "quanto mais empuxo, mais quente o motor e menor a folga até o limite",
                   loc="left", fontsize=10, color=TEXTO)
    fig.tight_layout()
    caminho = FIGURAS / "02_validacao_margem_egt.png"
    fig.savefig(caminho, dpi=130)
    plt.close(fig)
    return caminho


def main() -> None:
    FIGURAS.mkdir(parents=True, exist_ok=True)
    icao = versoes_originais()
    modelo = rodar_modelo(icao)
    df, deslocamento = validar(icao, modelo)

    print("Modelo calibrado (decolagem, nível do mar, 15 °C):")
    print(df[["motor", "vazao_ar_kg_s", "razao_pressao_fan", "T3_c", "T4_k", "egt_isa_modelo_c"]]
          .round(2).to_string(index=False))

    print(f"\nCalibração: deslocamento de EGT = {deslocamento:+.0f} °C (calculado só com o {VERSAO_CALIBRACAO})")
    print("\nValidação: margem de EGT de motor novo a 30 °C")
    print(df[["motor", "margem_pub_min", "margem_pub_max", "margem_prevista_c", "erro_c", "dentro_da_faixa"]]
          .round(1).to_string(index=False))
    teste = df[df["motor"] != VERSAO_CALIBRACAO]
    print(f"Erro médio nas 5 versões de validação: {teste['erro_c'].abs().mean():.1f} °C")

    print("\nSensibilidade às hipóteses (erro nas 5 versões de validação):")
    print(sensibilidade(icao).round({"erro_medio_abs_c": 1, "pior_erro_c": 1}).to_string(index=False))

    salvar = df.drop(columns=["estado_isa"])
    salvar["deslocamento_egt_c"] = deslocamento
    with sqlite3.connect(BANCO) as con:
        salvar.to_sql("modelo_ciclo", con, if_exists="replace", index=False)

    estado_7b24 = df.set_index("motor").loc[VERSAO_CALIBRACAO, "estado_isa"]
    print(f"\nFiguras:\n  {figura_perfil(estado_7b24)}\n  {figura_validacao(df)}")


if __name__ == "__main__":
    main()
