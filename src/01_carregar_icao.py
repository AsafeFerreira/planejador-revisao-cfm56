"""Etapa 1: carrega os dados públicos do CFM56-7B do banco de emissões da ICAO.

Fonte: ICAO Aircraft Engine Emissions Databank, versão 32B (11/2026), hospedado pela EASA.
São dados de certificação, medidos em banco de provas e publicados pela ICAO.
Não são dados da GE nem da GE Celma.

O que a ICAO publica para cada versão de motor:
  - empuxo máximo de decolagem (kN), razão de bypass e razão de pressão global
  - consumo de combustível (kg/s) nos 4 regimes do ciclo LTO (pouso e decolagem):
        decolagem (100% do empuxo), subida (85%), aproximação (30%) e marcha lenta (7%)
  - emissões (NOx, CO, HC, fumaça) em cada regime

O script:
  1. Filtra as linhas do CFM56-7B e tira as duplicadas/substituídas.
  2. Traduz as colunas para português e calcula o consumo específico (TSFC).
  3. Confere o cálculo do ciclo LTO contra o total que a própria ICAO publica.
  4. Salva tudo em dados/cfm56.db (SQLite), tabela icao_cfm56_7b.

Como rodar:  .venv/bin/python src/01_carregar_icao.py
"""
import sqlite3
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
PLANILHA = RAIZ / "dados" / "brutos" / "icao_emissions_databank_v32B.xlsx"
BANCO = RAIZ / "dados" / "cfm56.db"

# Ciclo LTO padrão da ICAO (Anexo 16, Volume II): fração do empuxo e tempo em cada regime.
# É um ciclo "de referência" abaixo de 3.000 pés, igual para todos os motores,
# para dar para comparar um motor com outro.
CICLO_LTO = {
    #  regime          (fração do empuxo, minutos)
    "decolagem":       (1.00, 0.7),
    "subida":          (0.85, 2.2),
    "aproximacao":     (0.30, 4.0),
    "marcha_lenta":    (0.07, 26.0),
}

# Nomes originais da planilha → nomes em português
COLUNAS = {
    "UID No": "uid",
    "Engine Identification": "motor",
    "Combustor Description": "camara",
    "B/P Ratio": "razao_bypass",
    "Pressure Ratio": "razao_pressao",
    "Rated Thrust (kN)": "empuxo_kn",
    "Fuel Flow T/O (kg/sec)": "consumo_decolagem_kg_s",
    "Fuel Flow C/O (kg/sec)": "consumo_subida_kg_s",
    "Fuel Flow App (kg/sec)": "consumo_aproximacao_kg_s",
    "Fuel Flow Idle (kg/sec)": "consumo_marcha_lenta_kg_s",
    "Fuel LTO Cycle (kg)  ": "combustivel_lto_icao_kg",  # o nome original tem 2 espaços no fim
    "NOx EI T/O (g/kg)": "nox_decolagem_g_kg",
    "Initial Test Date": "data_teste",
    "Current Engine Status": "situacao",
}

# Conversão de g/(kN·s) para lb/(lbf·h), a unidade usada nos catálogos de motores.
# 1 g/(kN·s) = 1e-6 kg/(N·s); × 4,44822 N/lbf × 2,20462 lb/kg × 3600 s/h = 0,0353
G_KN_S_PARA_LB_LBF_H = 1e-6 * 4.44822 * 2.20462 * 3600


def geracao(nome: str) -> str:
    """Classifica a versão pelo sufixo do nome.

    - sem sufixo: versão original (anos 1990)
    - /2: câmara de combustão dupla (DAC), feita para emitir menos NOx
          (no banco, o NOx de decolagem do /2 é ~34% menor que o da versão original)
    - /3: "Tech Insertion", pacote de melhorias de 2005 (a ICAO escreve isso na coluna da câmara)
    - E: "Evolution", versão de 2011 com melhorias de consumo
    """
    sufixo = nome.replace("CFM56-", "")
    if "E" in sufixo[3:]:      # 7B24E, 7B26E/B1... (olha depois do "7B" + empuxo)
        return "Evolution (E)"
    if "/3" in sufixo:
        return "Tech Insertion (/3)"
    if "/2" in sufixo:
        return "Câmara dupla DAC (/2)"
    return "Original"


def carregar() -> pd.DataFrame:
    bruto = pd.read_excel(PLANILHA, sheet_name="Gaseous Emissions and Smoke")

    # Só CFM56-7B; tira linhas substituídas por uma versão mais nova dos mesmos dados
    # e a medição de pesquisa (repete os números da certificação do 7B26/3).
    df = bruto[bruto["Engine Identification"].astype(str).str.startswith("CFM56-7B")]
    df = df[df["Data Superseded"].ne("Yes")]
    df = df[~df["Engine Identification"].str.contains("Research")]

    df = df[list(COLUNAS)].rename(columns=COLUNAS)
    df["geracao"] = df["motor"].apply(geracao)
    df["classe_empuxo"] = df["motor"].str.extract(r"(7B\d\d)")  # 7B18, 7B20, ..., 7B27

    # TSFC (consumo específico de combustível): quanto combustível o motor queima por
    # unidade de empuxo. Quanto MENOR, mais eficiente. Calculado na decolagem.
    df["tsfc_decolagem_g_kn_s"] = df["consumo_decolagem_kg_s"] * 1000 / df["empuxo_kn"]
    df["tsfc_decolagem_lb_lbf_h"] = df["tsfc_decolagem_g_kn_s"] * G_KN_S_PARA_LB_LBF_H

    # Combustível do ciclo LTO = soma de (consumo em kg/s × tempo em segundos) nos 4 regimes
    df["combustivel_lto_calculado_kg"] = sum(
        df[f"consumo_{regime}_kg_s"] * minutos * 60 for regime, (_, minutos) in CICLO_LTO.items()
    )
    return df.sort_values(["classe_empuxo", "data_teste"]).reset_index(drop=True)


def main() -> None:
    df = carregar()

    # Conferência: o nosso cálculo do ciclo LTO tem que bater com o total publicado pela ICAO
    diferenca = (df["combustivel_lto_calculado_kg"] - df["combustivel_lto_icao_kg"]).abs().max()
    print(f"Conferência do ciclo LTO: maior diferença para o total da ICAO = {diferenca:.2f} kg")

    with sqlite3.connect(BANCO) as con:
        df.to_sql("icao_cfm56_7b", con, if_exists="replace", index=False)

    print(f"\n{len(df)} versões do CFM56-7B salvas em {BANCO.name} (tabela icao_cfm56_7b)\n")
    resumo = df[df["geracao"] == "Original"][
        ["motor", "empuxo_kn", "razao_bypass", "razao_pressao",
         "consumo_decolagem_kg_s", "consumo_marcha_lenta_kg_s", "tsfc_decolagem_lb_lbf_h"]
    ]
    print("Versões originais (dados de certificação ICAO):")
    print(resumo.round(3).to_string(index=False))

    print("\nComo o empuxo muda o motor (versões originais, da menor para a maior):")
    menor, maior = resumo.iloc[0], resumo.iloc[-1]
    print(f"  empuxo: {menor.empuxo_kn:.0f} → {maior.empuxo_kn:.0f} kN  "
          f"| razão de pressão: {menor.razao_pressao:.1f} → {maior.razao_pressao:.1f}  "
          f"| bypass: {menor.razao_bypass} → {maior.razao_bypass}")


if __name__ == "__main__":
    main()
