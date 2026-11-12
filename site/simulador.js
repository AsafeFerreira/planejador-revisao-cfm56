// Simulador da oficina, em JavaScript, para rodar no navegador.
//
// É uma TRADUÇÃO FIEL de src/frota.py e src/desgaste.py (mesmas regras, mesma ordem
// das contas). O teste site/teste_simulador.mjs compara este arquivo com o resultado
// do Python no cenário nominal: as duas versões têm que dar exatamente as mesmas revisões.
//
// Frota fictícia. Parâmetros de fontes públicas. Nenhum dado da GE, CFM ou Celma.

export const NA_ASA = 0, NA_FILA = 1, NA_OFICINA = 2;

// ------------------------------------------------------------ desgaste (desgaste.py)
// perda(n) = A·(1 − e^(−n/τ)) + taxa·n   → amaciamento rápido + desgaste lento
// Um par (perda nos primeiros 1.000 ciclos, taxa madura) para cada motor.
export function criarDesgaste(perda1000, taxa, tau) {
  const fator = 1 - Math.exp(-1000 / tau);
  const A = perda1000.map((p, i) => (p - taxa[i]) / fator);  // °C perdidos no amaciamento
  return {
    perda: (i, efc) => A[i] * (1 - Math.exp(-efc / tau)) + taxa[i] / 1000 * efc,
  };
}

export const desgasteNominal = (n, tau) =>
  criarDesgaste(Array(n).fill(13), Array(n).fill(5), tau);

// Faixas publicadas: 11–15 °C no 1º milhar de ciclos e 4–6 °C/1.000 depois.
// "lento" e "rápido" usam a metade de baixo e a de cima das faixas.
export const RITMOS = {
  lento:  { perda: [11, 13], taxa: [4, 5] },
  normal: { perda: [11, 15], taxa: [4, 6] },
  rapido: { perda: [13, 15], taxa: [5, 6] },
};

export function sortearDesgaste(n, rng, ritmo, tau) {
  const { perda, taxa } = RITMOS[ritmo];
  const u = ([lo, hi]) => lo + (hi - lo) * rng();
  return criarDesgaste(Array.from({ length: n }, () => u(perda)),
                       Array.from({ length: n }, () => u(taxa)), tau);
}

// Gerador de números aleatórios com semente (mulberry32): o mesmo clique dá o mesmo resultado.
export function criarRng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ estado da frota
// Monta o estado de jan/2027 a partir do dados.json, "reancorando" a margem:
// o planejador conhece a margem de hoje; ao trocar o ritmo de desgaste, ajustamos a
// margem do início da vida para que margem_ini − perda(efc_vida) = margem de hoje.
export function estadoInicial(dados, desgaste) {
  const f = dados.frota;
  return {
    versao: [...f.versao], util: [...f.util], entrega: [...f.entrega],
    margemIni: f.margem_hoje.map((m, i) => m + desgaste.perda(i, f.efc_vida[i])),
    efcVida: [...f.efc_vida], efcTotal: [...f.efc_total],
    llp: f.llp.map((l) => [...l]), status: [...f.status], retorno: [...f.retorno],
    revisoes: [...f.revisoes], fila: [], removidos: new Map(),
  };
}

// ------------------------------------------------------------ revisão (workscope)
function revisar(e, i, mes, P, op, rng) {
  const v = e.versao[i];
  // "casada": troca a LLP se ela não aguentar até a próxima remoção por EGT.
  // "stub_minimo": troca só se sobrar menos de 5.000 ciclos.
  const limiar = op.politica === "stub_minimo" ? P.stub_minimo : P.intervalo_planejado[v];
  const troca = e.llp[i].map((vida) => vida < limiar);
  let gasto = 0, desperdicio = 0;
  const trocadas = [];
  troca.forEach((t, g) => {
    if (!t) return;
    const sobra = Math.max(e.llp[i][g], 0);                       // vida jogada fora
    desperdicio += sobra * (P.preco_llp[g] / P.vida_llp[g]);
    gasto += P.preco_llp[g];
    trocadas.push(P.grupos_llp[g]);
    e.llp[i][g] = P.vida_llp[g];
  });
  const [lo, hi] = P.margem_restaurada[v];
  e.margemIni[i] = op.sortear ? lo + (hi - lo) * rng() : (lo + hi) / 2;
  e.efcVida[i] = 0;
  e.status[i] = NA_OFICINA;
  e.retorno[i] = mes + op.tat;
  e.revisoes[i] += 1;
  return { motor: i, entrada: mes, llps_trocadas: trocadas, gasto_llp: gasto, desperdicio };
}

// ------------------------------------------------------------ simulação mês a mês
// op = { politica, capacidade (null = sem limite), tat, sortear, gravarFotos }
export function simular(estado, mesInicial, nMeses, desgaste, rng, P, op) {
  const e = estado;
  const n = e.util.length;
  const revisoes = [], resumo = [], fotos = [];
  for (let m = mesInicial; m < mesInicial + nMeses; m++) {
    // 1) quem terminou a revisão volta para a asa
    for (let i = 0; i < n; i++)
      if (e.status[i] === NA_OFICINA && e.retorno[i] <= m) e.status[i] = NA_ASA;

    // 2) cada motor na asa voa o seu mês; se for passar do limite, sai antes
    let porEgt = 0, porLlp = 0, porAmbos = 0;
    const saem = [];
    for (let i = 0; i < n; i++) {
      if (e.status[i] !== NA_ASA || e.entrega[i] > m) continue;
      const margemAgora = e.margemIni[i] - desgaste.perda(i, e.efcVida[i]);
      const efcFim = e.efcVida[i] + e.util[i];
      const margemFim = e.margemIni[i] - desgaste.perda(i, efcFim);
      const llpFim = e.llp[i].map((vida) => vida - e.util[i]);
      const egt = margemFim <= P.margem_minima;
      const llp = llpFim.some((vida) => vida <= 0);
      if (egt || llp) {
        const causa = egt && llp ? "EGT + LLP" : egt ? "EGT" : "LLP";
        if (egt && llp) porAmbos++; else if (egt) porEgt++; else porLlp++;
        e.removidos.set(i, { remocao: m, causa, margem: margemAgora, efc_na_asa: e.efcVida[i] });
        saem.push(i);
      } else {
        e.efcVida[i] = efcFim;
        e.efcTotal[i] += e.util[i];
        e.llp[i] = llpFim;
      }
    }
    for (const i of saem) { e.status[i] = NA_FILA; e.fila.push(i); }

    // 3) a oficina recebe até "capacidade" motores, por ordem de chegada
    const vagas = op.capacidade == null ? e.fila.length : op.capacidade;
    const entram = e.fila.splice(0, vagas);
    for (const i of entram) {
      const r = revisar(e, i, m, P, op, rng);
      Object.assign(r, e.removidos.get(i));
      e.removidos.delete(i);
      r.espera = m - r.remocao;
      revisoes.push(r);
    }

    let naOficina = 0;
    for (let i = 0; i < n; i++) if (e.status[i] === NA_OFICINA) naOficina++;
    resumo.push({ mes: m, remocoes: saem.length, porEgt, porLlp, porAmbos,
                  entradas: entram.length, naFila: e.fila.length, naOficina,
                  foraDaAsa: e.fila.length + naOficina });   // = motores reserva necessários

    if (op.gravarFotos) {
      fotos.push({
        status: Int8Array.from(e.status),
        margem: Float32Array.from(e.margemIni, (m0, i) => m0 - desgaste.perda(i, e.efcVida[i])),
      });
    }
  }
  return { revisoes, resumo, fotos };
}

// ------------------------------------------------------------ Monte Carlo
// Repete o futuro N vezes com ritmos de desgaste sorteados e resume a incerteza.
const quantil = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, base = Math.floor(pos);
  return s[base] + (s[Math.min(base + 1, s.length - 1)] - s[base]) * (pos - base);
};

export function monteCarlo(dados, op, nFuturos = 200, semente = 1) {
  const P = dados.parametros, H = dados.horizonte, n = dados.frota.util.length;
  const rng = criarRng(semente);
  const remocoes = Array.from({ length: H }, () => ({ egt: 0, llp: 0 }));
  const fora = Array.from({ length: H }, () => []);
  const porFuturo = [];
  for (let k = 0; k < nFuturos; k++) {
    const desgaste = sortearDesgaste(n, rng, op.ritmo, P.tau);
    const estado = estadoInicial(dados, desgaste);
    const { revisoes, resumo } = simular(estado, 0, H, desgaste, rng, P,
                                         { ...op, sortear: true });
    resumo.forEach((r, m) => {
      remocoes[m].egt += r.porEgt / nFuturos;
      remocoes[m].llp += (r.porLlp + r.porAmbos) / nFuturos;
      fora[m].push(r.foraDaAsa);
    });
    const desperdicio = revisoes.reduce((s, r) => s + r.desperdicio, 0);
    porFuturo.push({
      revisoes: revisoes.length,
      porLlp: revisoes.filter((r) => r.causa === "LLP").length,
      desperdicio,
      custo: revisoes.length * op.custoRevisao + desperdicio,
      espera: revisoes.length ? revisoes.reduce((s, r) => s + r.espera, 0) / revisoes.length : 0,
      picoFora: Math.max(...resumo.map((r) => r.foraDaAsa)),
    });
  }
  const media = (campo) => porFuturo.reduce((s, f) => s + f[campo], 0) / nFuturos;
  return {
    remocoes,
    fora: fora.map((xs) => ({ p10: quantil(xs, 0.1), p50: quantil(xs, 0.5), p90: quantil(xs, 0.9) })),
    revisoes: media("revisoes"),
    pctLlp: 100 * media("porLlp") / Math.max(media("revisoes"), 1e-9),
    desperdicio: media("desperdicio"),
    custo: media("custo"),
    espera: media("espera"),
    reservasP90: quantil(porFuturo.map((f) => f.picoFora), 0.9),
  };
}
