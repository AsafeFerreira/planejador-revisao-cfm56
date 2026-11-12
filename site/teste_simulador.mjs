// Teste: o simulador em JavaScript dá o mesmo resultado que o Python?
// Roda o plano nominal (ritmo médio, 2 entradas/mês, sem sorteio) e compara cada
// revisão com a referência que src/05_exportar_site.py gravou em dados.json.
//
// Como rodar:  node site/teste_simulador.mjs
import { readFileSync } from "node:fs";
import { criarRng, desgasteNominal, estadoInicial, simular } from "./simulador.js";

const dados = JSON.parse(readFileSync(new URL("./dados.json", import.meta.url)));
const P = dados.parametros, ref = dados.referencia_python;
const desgaste = desgasteNominal(dados.frota.util.length, P.tau);
const { revisoes, resumo } = simular(estadoInicial(dados, desgaste), 0, dados.horizonte, desgaste,
  criarRng(0), P, { politica: "casada", capacidade: P.capacidade_plano, tat: P.tat_meses, sortear: false });

let erros = 0;
const falha = (msg) => { erros++; if (erros <= 10) console.log("  ✗", msg); };

if (revisoes.length !== ref.revisoes.length)
  falha(`número de revisões: JS ${revisoes.length}, Python ${ref.revisoes.length}`);
ref.revisoes.forEach((r, k) => {
  const j = revisoes[k];
  if (!j) return;
  for (const campo of ["remocao", "entrada", "motor", "causa"])
    if (j[campo] !== r[campo]) falha(`revisão ${k}, ${campo}: JS ${j[campo]}, Python ${r[campo]}`);
  if (Math.abs(j.margem - r.margem) > 1e-3) falha(`revisão ${k}, margem: JS ${j.margem}, Python ${r.margem}`);
});
resumo.forEach((r, m) => {
  if (r.remocoes !== ref.remocoes_por_mes[m]) falha(`mês ${m}: remoções diferentes`);
  if (r.foraDaAsa !== ref.fora_da_asa[m]) falha(`mês ${m}: motores fora da asa diferentes`);
});

console.log(erros === 0
  ? `✓ JavaScript igual ao Python: ${revisoes.length} revisões e ${resumo.length} meses conferidos`
  : `✗ ${erros} diferença(s)`);
process.exit(erros === 0 ? 0 : 1);
