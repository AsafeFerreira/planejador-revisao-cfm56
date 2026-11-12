"""Etapa 5: exporta para o site os dados que o simulador do navegador precisa.

O site (pasta site/) roda o simulador em JavaScript, direto no navegador, sem servidor.
Este script gera site/dados.json com:
  - a frota fictícia como ela está em jan/2027 (saída da etapa 4);
  - os parâmetros públicos (margens, vidas e preços das LLPs, custo de revisão);
  - um resultado de REFERÊNCIA do Python (plano nominal), usado pelo teste
    site/teste_simulador.mjs para provar que o JavaScript dá exatamente o mesmo resultado;
  - resumos das etapas 2 e 3 para a seção "Como foi feito".

Como rodar:  .venv/bin/python src/05_exportar_site.py
             node site/teste_simulador.mjs
"""
import importlib
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

import frota as F
from desgaste import NOMINAL, TAU_AMACIAMENTO

plan = importlib.import_module("04_planejamento")  # nome começa com número: importa assim

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "site" / "dados.json"


def lista(x, casas=2):
    return np.round(np.asarray(x, dtype=float), casas).tolist()


def main() -> None:
    hoje, desgaste_real, tabela, _ = plan.frota_hoje()
    margem_hoje = hoje.margem_ini - desgaste_real.perda(hoje.efc_vida)

    # Referência para o teste: plano nominal com 2 entradas por mês.
    # Usa a margem de hoje ARREDONDADA, a mesma que vai no JSON, para os dois lados
    # partirem exatamente do mesmo ponto.
    estado = hoje.copia()
    margem_json = np.round(margem_hoje, 4)
    estado.efc_vida = np.round(estado.efc_vida, 4)
    estado.util = np.round(estado.util, 4)
    estado.llp = np.round(estado.llp, 4)
    estado.margem_ini = margem_json + NOMINAL.perda(estado.efc_vida)
    _, rev, res = F.simular(estado, 0, plan.HORIZONTE, NOMINAL, np.random.default_rng(0),
                            capacidade=plan.CAPACIDADE_PLANO, sortear=False)

    with sqlite3.connect(RAIZ / "dados" / "cfm56.db") as con:
        validacao = pd.read_sql("SELECT motor, margem_pub_min, margem_pub_max, margem_prevista_c "
                                "FROM modelo_ciclo", con)
        taxas = pd.read_sql("SELECT * FROM taxas_de_troca", con)
        intervalos = pd.read_sql("SELECT motor, intervalo_pub_min, intervalo_pub_max, previsto_nominal, "
                                 "previsto_cadeia_completa FROM intervalos_primeira_vida", con)

    dados = {
        "aviso": "Frota fictícia. Parâmetros de fontes públicas. Nenhum dado da GE, CFM ou Celma.",
        "inicio": str(plan.INICIO),
        "horizonte": plan.HORIZONTE,
        "parametros": {
            "versoes": F.VERSOES,
            "margem_nova": {str(k): v for k, v in F.MARGEM_NOVA.items()},
            "margem_restaurada": {str(k): v for k, v in F.MARGEM_RESTAURADA.items()},
            "grupos_llp": F.GRUPOS_LLP,
            "vida_llp": F.VIDA_LLP.tolist(),
            "preco_llp": F.PRECO_LLP.tolist(),
            "custo_revisao": F.CUSTO_REVISAO,
            "tat_meses": F.TAT_MESES,
            "stub_minimo": F.STUB_MINIMO,
            "margem_minima": F.MARGEM_MINIMA,
            "tau": TAU_AMACIAMENTO,
            "intervalo_planejado": {str(k): v for k, v in F.INTERVALO_PLANEJADO.items()},
            "capacidade_plano": plan.CAPACIDADE_PLANO,
        },
        "frota": {
            "motor": tabela.motor.tolist(), "aviao": tabela.aviao.tolist(),
            "versao": hoje.versao.tolist(), "util": lista(estado.util, 4),
            "entrega": hoje.entrega.tolist(), "margem_hoje": lista(margem_json, 4),
            "efc_vida": lista(estado.efc_vida, 4), "efc_total": lista(hoje.efc_total, 1),
            "llp": np.round(estado.llp, 4).tolist(), "status": hoje.status.tolist(),
            "retorno": hoje.retorno.tolist(), "revisoes": hoje.revisoes.tolist(),
        },
        "referencia_python": {
            "revisoes": rev[["remocao", "entrada", "motor", "causa"]].assign(
                margem=rev.margem_na_remocao.round(3)).to_dict("records"),
            "remocoes_por_mes": res.remocoes.tolist(),
            "fora_da_asa": res.fora_da_asa.tolist(),
        },
        "etapas": {
            "validacao_margem": validacao.round(1).to_dict("records"),
            "taxas_de_troca": taxas.round(2).to_dict("records"),
            "intervalos": intervalos.round(0).to_dict("records"),
        },
    }
    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(json.dumps(dados, ensure_ascii=False, default=int))
    print(f"{SAIDA.relative_to(RAIZ)}: {SAIDA.stat().st_size / 1024:.0f} kB, "
          f"{len(rev)} revisões na referência")


if __name__ == "__main__":
    main()
