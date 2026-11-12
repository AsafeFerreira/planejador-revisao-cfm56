"""Etapa 4: planejamento da oficina para uma frota fictícia de CFM56-7B.

Pergunta de negócio: "quantos motores vão chegar na oficina em cada mês dos próximos
10 anos, por quê, e quanta capacidade e quantos motores reserva isso exige?"

AVISO: a frota é INVENTADA (50 aviões 737NG, 100 motores). Nenhum dado da GE, da CFM
ou da Celma. Parâmetros de fontes públicas (Aircraft Commerce nº 58 e 87) e das
etapas anteriores deste projeto.

Passos:
  1) Inventa a frota e roda o histórico desde a entrega de cada avião, com o
     desgaste "real" de cada motor. Resultado: a frota como ela está em jan/2027.
  2) Plano nominal: a fila de entrada na oficina, mês a mês (cenário médio).
  3) Monte Carlo: repete o futuro 500 vezes sorteando o ritmo de desgaste e a margem
     restaurada, para mostrar a incerteza (faixa P10–P90) da demanda.
  4) Capacidade: com 1, 2 ou 3 entradas por mês, quantos motores esperam na fila e
     quantos motores reserva a companhia precisa.
  5) Política de LLPs: trocar cedo (casada com a EGT) ou aproveitar o resto da vida
     (stub mínimo)? Compara o custo das duas.

Como rodar:  .venv/bin/python src/04_planejamento.py
"""
import sqlite3
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from desgaste import NOMINAL
from frota import (CUSTO_REVISAO, GRUPOS_LLP, NA_ASA, VERSOES, criar_frota, reancorar,
                   simular, sortear_desgaste)

RAIZ = Path(__file__).resolve().parent.parent
BANCO = RAIZ / "dados" / "cfm56.db"
FIGURAS = RAIZ / "docs" / "figuras"

INICIO = pd.Period("2027-01", "M")   # mês 0 do plano
HORIZONTE = 120                      # meses (10 anos)
N_SIMULACOES = 500
CAPACIDADE_PLANO = 2                 # entradas por mês reservadas para esta companhia (hipótese)

AZUL, LARANJA, VERDE_AZULADO = "#2a78d6", "#eb6834", "#1baf7a"
CINZA, TEXTO, TEXTO_2, FUNDO = "#b5b3ad", "#0b0b0b", "#52514e", "#fcfcfb"
plt.rcParams.update({
    "figure.facecolor": FUNDO, "axes.facecolor": FUNDO, "axes.edgecolor": CINZA,
    "axes.labelcolor": TEXTO_2, "xtick.color": TEXTO_2, "ytick.color": TEXTO_2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": "#e6e5e0", "grid.linewidth": 0.6, "axes.axisbelow": True, "font.size": 9,
})


def mes_para_data(m) -> str:
    return str(INICIO + int(m))


# ---------------------------------------------------------------- 1) frota hoje

def frota_hoje():
    """Roda os 12 anos de história da frota até o início do plano."""
    estado, desgaste_real, cadastro = criar_frota()
    rng = np.random.default_rng(7)
    inicio_hist = int(estado.entrega.min())
    hoje, revisoes_passadas, _ = simular(estado, inicio_hist, -inicio_hist, desgaste_real, rng)

    tabela = cadastro.copy()
    tabela["entrada_em_servico"] = [mes_para_data(m) for m in hoje.entrega]
    tabela["efc_por_mes"] = hoje.util.round(0)
    tabela["efc_total"] = hoje.efc_total.round(0)
    tabela["efc_desde_revisao"] = hoje.efc_vida.round(0)
    tabela["revisoes_feitas"] = hoje.revisoes
    tabela["margem_egt_hoje"] = (hoje.margem_ini - desgaste_real.perda(hoje.efc_vida)).round(1)
    for j, g in enumerate(GRUPOS_LLP):
        tabela[f"vida_llp_{g}"] = hoje.llp[:, j].round(0)
    tabela["na_asa"] = hoje.status == NA_ASA
    return hoje, desgaste_real, tabela, revisoes_passadas


# ---------------------------------------------------------------- 2) plano nominal

def plano_nominal(hoje, desgaste_real, cadastro) -> pd.DataFrame:
    """Cenário médio: todo motor desgasta no ritmo nominal daqui para frente."""
    estado = reancorar(hoje, desgaste_real, NOMINAL)
    _, revisoes, _ = simular(estado, 0, HORIZONTE, NOMINAL, np.random.default_rng(0),
                             capacidade=CAPACIDADE_PLANO, sortear=False)
    i = revisoes.motor.values  # posição do motor nos vetores
    plano = revisoes.assign(
        motor=cadastro.motor.values[i], aviao=cadastro.aviao.values[i], versao=cadastro.versao.values[i],
        mes_remocao=lambda d: d.remocao.map(mes_para_data),
        mes_entrada=lambda d: d.entrada.map(mes_para_data),
    )
    return plano[["mes_remocao", "mes_entrada", "espera_meses", "motor", "aviao", "versao", "causa",
                  "margem_na_remocao", "efc_na_asa", "efc_total", "llps_trocadas",
                  "gasto_llp_usd", "desperdicio_usd"]].round(1)


# ---------------------------------------------------------------- 3–5) Monte Carlo

def monte_carlo(hoje, desgaste_real, n=N_SIMULACOES, capacidade=None, politica="casada", semente=1):
    """Repete o futuro n vezes. Em cada repetição, cada motor ganha um ritmo de desgaste
    sorteado (o planejador não sabe o ritmo real) e cada revisão sorteia a margem
    restaurada. Devolve o resumo mensal e as revisões de todas as repetições."""
    sementes = np.random.SeedSequence(semente).spawn(n)
    resumos, revisoes = [], []
    for k, s in enumerate(sementes):
        rng = np.random.default_rng(s)
        desgaste = sortear_desgaste(len(hoje.util), rng)
        estado = reancorar(hoje, desgaste_real, desgaste)
        _, rev, res = simular(estado, 0, HORIZONTE, desgaste, rng,
                              politica=politica, capacidade=capacidade)
        resumos.append(res.assign(rodada=k))
        revisoes.append(rev.assign(rodada=k))
    return pd.concat(resumos), pd.concat(revisoes)


def demanda(resumos: pd.DataFrame) -> pd.DataFrame:
    """Remoções por mês: média e faixa P10–P90 entre as repetições."""
    g = resumos.groupby("mes")
    out = pd.DataFrame({
        "media": g.remocoes.mean(), "p10": g.remocoes.quantile(0.10), "p90": g.remocoes.quantile(0.90),
        "por_egt": g.por_egt.mean(), "por_llp": g.por_llp.mean() + g.por_ambos.mean(),
    })
    out.insert(0, "mes_data", [mes_para_data(m) for m in out.index])
    return out.round(2)


def demanda_anual(resumos: pd.DataFrame) -> pd.DataFrame:
    anual = resumos.assign(ano=INICIO.year + resumos.mes // 12).groupby(["rodada", "ano"]).remocoes.sum()
    g = anual.groupby("ano")
    return pd.DataFrame({"p10": g.quantile(0.10), "mediana": g.median(), "p90": g.quantile(0.90)}).astype(int)


def estudo_capacidade(hoje, desgaste_real) -> pd.DataFrame:
    """Para cada capacidade: fila máxima, espera média e motores reserva (P90 do pico
    de motores fora da asa). Reserva = cobre 9 em cada 10 futuros simulados."""
    linhas = []
    for cap in (1, 2, 3):
        res, rev = monte_carlo(hoje, desgaste_real, n=300, capacidade=cap, semente=2)
        pico = res.groupby("rodada").fora_da_asa.max()
        linhas.append({"entradas_por_mes": cap,
                       "fila_maxima_p90": res.groupby("rodada").na_fila.max().quantile(0.9),
                       "espera_media_meses": rev.espera_meses.mean(),
                       "reservas_necessarias_p90": pico.quantile(0.9)})
    return pd.DataFrame(linhas).round(1)


def comparar_politicas(hoje, desgaste_real) -> pd.DataFrame:
    """Custo em 10 anos de cada política de troca de LLP.

    Conta só o que muda entre as políticas:
      - revisões × CUSTO_REVISAO (mão de obra e materiais, sem LLPs);
      - vida de LLP jogada fora (desperdício).
    A vida de LLP realmente usada em voo custa o mesmo nas duas, então fica de fora."""
    linhas = []
    for pol in ("casada", "stub_minimo"):
        res, rev = monte_carlo(hoje, desgaste_real, n=300, politica=pol, semente=3)
        por_rodada = rev.groupby("rodada")
        n_rev = por_rodada.size()
        desperdicio = por_rodada.desperdicio_usd.sum()
        linhas.append({"politica": pol,
                       "revisoes_10_anos": n_rev.mean(),
                       "forcadas_por_llp_pct": 100 * (rev.causa == "LLP").mean(),
                       "desperdicio_llp_musd": desperdicio.mean() / 1e6,
                       "custo_revisoes_musd": n_rev.mean() * CUSTO_REVISAO / 1e6,
                       "custo_total_musd": (n_rev * CUSTO_REVISAO + desperdicio).mean() / 1e6})
    tab = pd.DataFrame(linhas)
    # A partir de que custo de revisão a política casada compensa?
    a, b = tab.set_index("politica").loc["casada"], tab.set_index("politica").loc["stub_minimo"]
    tab.attrs["custo_equilibrio_usd"] = ((a.desperdicio_llp_musd - b.desperdicio_llp_musd) * 1e6
                                         / (b.revisoes_10_anos - a.revisoes_10_anos))
    return tab.round(1)


# ---------------------------------------------------------------- figura

def figura(dem: pd.DataFrame, res_por_cap: dict) -> Path:
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(9, 6.4), sharex=False,
                                   gridspec_kw={"height_ratios": [1.1, 1], "hspace": 0.45})

    # Em cima: remoções por trimestre (mês a mês fica ilegível com números tão pequenos)
    tri = dem.assign(t=dem.index // 3).groupby("t")
    x = np.arange(len(tri))
    egt, llp = tri.por_egt.sum().values, tri.por_llp.sum().values
    ax1.bar(x, egt, width=0.7, color=AZUL, label="Margem de EGT acabou")
    ax1.bar(x, llp, width=0.7, bottom=egt + 0.03, color=LARANJA, label="LLP venceu")
    ax1.axhline(CAPACIDADE_PLANO * 3, color=TEXTO_2, lw=1, ls="--")
    ax1.text(len(x) - 0.5, CAPACIDADE_PLANO * 3 + 0.2, f"capacidade: {CAPACIDADE_PLANO}/mês",
             ha="right", va="bottom", color=TEXTO_2, fontsize=8)
    rotulos = [f"{INICIO.year + i // 4}" if i % 4 == 0 else "" for i in x]
    ax1.set_xticks(x, rotulos)
    ax1.set_ylabel("motores removidos\npor trimestre (média)")
    ax1.set_title("Demanda prevista na oficina (frota fictícia, 100 motores, 500 futuros simulados)",
                  loc="left", color=TEXTO, fontsize=10)
    ax1.legend(frameon=False, loc="upper left", fontsize=8)

    # Embaixo: motores fora da asa (= reservas necessárias) por capacidade
    cores = {1: LARANJA, 2: AZUL, 3: VERDE_AZULADO}
    meses = np.arange(HORIZONTE)
    for cap, res in res_por_cap.items():
        g = res.groupby("mes").fora_da_asa
        ax2.fill_between(meses, g.quantile(0.1), g.quantile(0.9), color=cores[cap], alpha=0.15, lw=0)
        ax2.plot(meses, g.median(), color=cores[cap], lw=2, label=f"{cap} entrada{'s' if cap > 1 else ''} por mês")
    ax2.set_xticks(np.arange(0, HORIZONTE, 12), [str(INICIO.year + i) for i in range(HORIZONTE // 12)])
    ax2.set_ylabel("motores fora da asa\n(reservas necessárias)")
    ax2.set_title("Capacidade da oficina × motores reserva (linha = mediana, faixa = P10–P90)",
                  loc="left", color=TEXTO, fontsize=10)
    ax2.legend(frameon=False, loc="upper left", fontsize=8)

    caminho = FIGURAS / "04_demanda_e_capacidade.png"
    fig.savefig(caminho, dpi=160, bbox_inches="tight")
    plt.close(fig)
    return caminho


# ---------------------------------------------------------------- principal

def main() -> None:
    pd.set_option("display.width", 200, "display.max_columns", 20)

    hoje, desgaste_real, frota, passadas = frota_hoje()
    print(f"Frota em {INICIO}: {len(frota)} motores, {passadas.shape[0]} revisões no histórico")
    print(frota.groupby("versao").agg(motores=("motor", "size"), efc_total_medio=("efc_total", "mean"),
                                      margem_media=("margem_egt_hoje", "mean"),
                                      margem_min=("margem_egt_hoje", "min")).round(0), "\n")

    plano = plano_nominal(hoje, desgaste_real, frota)
    print(f"Plano nominal ({CAPACIDADE_PLANO} entradas/mês) — primeiros 24 meses:")
    print(plano[plano.mes_remocao < mes_para_data(24)].to_string(index=False), "\n")

    res, rev = monte_carlo(hoje, desgaste_real)
    dem = demanda(res)
    anual = demanda_anual(res)
    print("Remoções por ano (500 futuros simulados):")
    print(anual.T, "\n")
    print(f"Causa das remoções: {rev.causa.value_counts(normalize=True).mul(100).round(0).to_dict()} %\n")

    cap = estudo_capacidade(hoje, desgaste_real)
    print("Capacidade da oficina:")
    print(cap.to_string(index=False), "\n")

    pol = comparar_politicas(hoje, desgaste_real)
    print("Política de troca de LLPs (10 anos, média de 300 futuros):")
    print(pol.to_string(index=False))
    print(f"Custo de revisão a partir do qual a política casada compensa: "
          f"US$ {pol.attrs['custo_equilibrio_usd'] / 1e6:.2f} milhão (fonte: 1,6–1,85)\n")

    res_por_cap = {c: monte_carlo(hoje, desgaste_real, n=300, capacidade=c, semente=2)[0] for c in (1, 2, 3)}
    print("Figura:", figura(dem, res_por_cap).relative_to(RAIZ))

    with sqlite3.connect(BANCO) as con:
        frota.to_sql("frota_atual", con, if_exists="replace", index=False)
        plano.to_sql("plano_oficina", con, if_exists="replace", index=False)
        dem.to_sql("demanda_mensal", con, if_exists="replace", index_label="mes")
        anual.to_sql("demanda_anual", con, if_exists="replace")
        cap.to_sql("estudo_capacidade", con, if_exists="replace", index=False)
        pol.to_sql("politicas_llp", con, if_exists="replace", index=False)
    print("Tabelas salvas em dados/cfm56.db")


if __name__ == "__main__":
    main()
