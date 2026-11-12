// Liga a página: arte, explicações interativas, simulador, gráficos e linha do tempo.
// As contas ficam em simulador.js (tradução fiel do Python); aqui é só interface.
import { ICONES, aviaoSVG, curvaFolgaSVG, motorSVG, mostradorSVG } from "./arte.js";
import { NA_FILA, NA_OFICINA, criarRng, desgasteNominal, estadoInicial, monteCarlo, simular } from "./simulador.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const LIMITE_REAL = [908, 920, 920];     // limite real de EGT do 7B24/26/27, °C (Aircraft Commerce nº 58)
const CICLOS_POR_ANO = 1700;             // ~3.100 h de voo por ano ÷ 1,9 h por ciclo (AC58)
const N_FUTUROS = 200;
const COR = {
  bom: "#0ca30c", atencao: "#fab219", critico: "#d03b3b", oficina: "#3987e5",
  azul: "#2a78d6", laranja: "#eb6834", azulEscuro: "#3987e5", laranjaEscuro: "#f07a45",
};

const $ = (s) => document.querySelector(s);
const num = (x, casas = 0) => x.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const milhoes = (usd, casas = 1) => `US$ ${num(usd / 1e6, casas)} mi`;

function estadoDaMargem(m) {
  if (m > 30) return { cor: COR.bom, txt: "Folga boa" };
  if (m > 10) return { cor: COR.atencao, txt: "Atenção" };
  return { cor: COR.critico, txt: m > 0 ? "Perto do limite" : "Folga acabou" };
}

const dados = await (await fetch("dados.json")).json();
const P = dados.parametros;
const [anoIni, mesIni] = dados.inicio.split("-").map(Number);
const nomeMes = (m) => { const t = anoIni * 12 + (mesIni - 1) + m; return `${MESES[t % 12]}/${Math.floor(t / 12)}`; };
const nMotores = dados.frota.util.length;

// ================================================================ arte do topo e capítulo 1
$("#arte-hero").innerHTML = motorSVG({ id: "hero" });
$("#arte-passos").innerHTML = motorSVG({ marcadores: true, id: "passos" });
document.querySelectorAll("[data-icone]").forEach((el) => (el.innerHTML = ICONES[el.dataset.icone]));

function ativarPasso(n) {
  document.querySelectorAll("#passos li").forEach((li) => li.classList.toggle("ativo", li.dataset.passo === String(n)));
  document.querySelectorAll(".marcador").forEach((g) => g.classList.toggle("ativo", g.dataset.passo === String(n)));
}
document.querySelectorAll("#passos li, .marcador").forEach((el) => {
  el.addEventListener("click", () => ativarPasso(el.dataset.passo));
  el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ativarPasso(el.dataset.passo); } });
});
ativarPasso(1);

// ================================================================ capítulo 2: a folga
// Usa a mesma curva de desgaste do projeto, no ritmo nominal.
const curva = desgasteNominal(1, P.tau);
const folga = { versao: 0, ciclos: Number($("#folga-ciclos").value) };

function ciclosAteZerar(margemNova) {
  let n = 0;
  while (margemNova - curva.perda(0, n) > 0 && n < 60000) n += 10;
  return n;
}

function desenharFolga() {
  const [lo, hi] = P.margem_nova[folga.versao];
  const nova = (lo + hi) / 2;
  const margem = nova - curva.perda(0, folga.ciclos);
  const limite = LIMITE_REAL[folga.versao];
  const egt = limite - margem;
  const est = estadoDaMargem(margem);
  const vida = ciclosAteZerar(nova);
  $("#folga-ciclos-txt").textContent = num(folga.ciclos);
  $("#folga-mostrador").innerHTML = mostradorSVG({ egt, limite, cor: est.cor });
  $("#folga-curva").innerHTML = curvaFolgaSVG({ folgaEm: (n) => nova - curva.perda(0, n), ciclos: folga.ciclos, zeraEm: vida });
  $("#cabine-versao").textContent = P.versoes[folga.versao];
  $("#cabine-led").style.background = est.cor;
  $("#cabine-folga").innerHTML = `<span class="ponto-status" style="background:${est.cor}"></span>
    folga <b>${num(Math.max(margem, 0))} °C</b> até o limite de ${limite} °C · ${est.txt}`;
  $("#folga-leitura").innerHTML = `
    <div><b>${num(Math.max(margem, 0))} °C</b><span>folga até o limite</span></div>
    <div><b>${num(egt)} °C</b><span>EGT na decolagem em dia quente</span></div>
    <div><b>~${num(vida / CICLOS_POR_ANO, 0)} anos</b><span>na asa até a folga acabar (${num(vida)} ciclos)</span></div>
`;
  // acende a faixa atual na lista (folga boa / atenção / perto do limite)
  const faixa = margem > 30 ? 0 : margem > 10 ? 1 : 2;
  document.querySelectorAll(".faixas li").forEach((li, k) => li.classList.toggle("ativa", k === faixa));
}
document.querySelectorAll("#folga-versao button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#folga-versao button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  folga.versao = Number(b.dataset.v);
  desenharFolga();
}));
$("#folga-ciclos").addEventListener("input", (ev) => { folga.ciclos = Number(ev.target.value); desenharFolga(); });
desenharFolga();

// ================================================================ capítulo 3: quem zera primeiro?
function desenharCorrida(v) {
  const [lo, hi] = P.margem_nova[v];
  const egt = ciclosAteZerar((lo + hi) / 2);
  const relogios = [
    { nome: "Folga de temperatura", sub: "margem de EGT", ciclos: egt, tipo: "egt" },
    { nome: "Peças do núcleo", sub: "compressor e turbina de alta", ciclos: P.vida_llp[1], tipo: "llp" },
    { nome: "Peças da turbina de baixa", sub: "LLPs da LPT", ciclos: P.vida_llp[2], tipo: "llp" },
    { nome: "Peças do fan e booster", sub: "LLPs do fan", ciclos: P.vida_llp[0], tipo: "llp" },
  ];
  const vence = Math.min(...relogios.map((r) => r.ciclos));
  const ESCALA = 32000, pct = (n) => (100 * n) / ESCALA;
  $("#corrida").innerHTML = relogios.map((r) => `
    <div class="corrida-rotulo"><b>${r.nome}${r.ciclos === vence ? ' <em class="selo-vence">zera primeiro</em>' : ""}</b><span>${r.sub}</span></div>
    <div class="corrida-trilho">
      <i class="barra ${r.tipo} ${r.ciclos === vence ? "vence" : ""}" style="width:${pct(r.ciclos)}%"></i>
      <span class="valor ${pct(r.ciclos) > 78 ? "dentro" : ""}" style="left:${pct(r.ciclos)}%">${num(r.ciclos)}</span>
      <i class="linha-revisao" style="left:${pct(vence)}%"></i>
    </div>`).join("");
  const quem = relogios.find((r) => r.ciclos === vence);
  const folgaLlp = P.vida_llp[1] - egt;
  $("#corrida-conclusao").innerHTML = `🔧 <b>Primeira revisão aos ${num(vence)} ciclos, cerca de ${num(vence / CICLOS_POR_ANO)} anos</b>,
    porque ${quem.tipo === "egt" ? "a folga de temperatura acaba" : "uma peça chega ao limite"} primeiro.
    ${quem.tipo === "egt" && folgaLlp < 3000 ? `As peças do núcleo venceriam só ${num(folgaLlp)} ciclos depois: é por isso que muitos 7B24 saem por um motivo ou pelo outro.`
      : quem.tipo === "egt" ? "As peças com validade ainda teriam bastante vida: é o motor de alta potência que gasta a folga mais cedo." : ""}`;
}
document.querySelectorAll("#corrida-versao button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#corrida-versao button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  desenharCorrida(Number(b.dataset.v));
}));
desenharCorrida(0);

// controles deslizantes: a parte "percorrida" fica colorida (variável CSS --p)
function pintarSlider(el) { el.style.setProperty("--p", `${(100 * (el.value - el.min)) / (el.max - el.min)}%`); }
document.querySelectorAll('input[type="range"]').forEach((el) => {
  pintarSlider(el);
  el.addEventListener("input", () => pintarSlider(el));
});

// ================================================================ gráficos (Chart.js)
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
// fonte dos gráficos acompanha o tamanho base da página (que cresce em telas grandes)
const BASE = parseFloat(getComputedStyle(document.documentElement).fontSize);
Chart.defaults.font.size = Math.round(BASE * 0.78);
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
const eixosEscuros = { ticks: { color: "#a9b6c6" }, grid: { color: "rgba(255,255,255,.07)" }, border: { color: "#24405f" } };
const eixosClaros = { ticks: { color: "#4b5563" }, grid: { color: "#ece8de" }, border: { color: "#d9d4c8" } };
const legenda = (cor) => ({ labels: { color: cor, usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, padding: 14 } });

const trimestres = Array.from({ length: dados.horizonte / 3 }, (_, t) => `${anoIni + Math.floor(t / 4)} T${(t % 4) + 1}`);
const gDemanda = new Chart($("#g-demanda"), {
  type: "bar",
  data: {
    labels: trimestres,
    datasets: [
      { label: "Folga de temperatura acabou", data: [], backgroundColor: COR.azulEscuro, borderRadius: 3, stack: "r" },
      { label: "Peça com validade venceu", data: [], backgroundColor: COR.laranjaEscuro, borderRadius: 3, stack: "r" },
      { label: "Capacidade da oficina", data: [], type: "line", borderColor: "#eef2f7", borderDash: [6, 5],
        borderWidth: 1.5, pointRadius: 0, stack: "cap" },
    ],
  },
  options: {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: legenda("#a9b6c6"),
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${num(c.parsed.y, 1)} motores` } } },
    scales: {
      x: { ...eixosEscuros, stacked: true, grid: { display: false }, ticks: { ...eixosEscuros.ticks, autoSkip: false, maxRotation: 0,
        callback: (_, i) => (i % 4 === 0 ? String(anoIni + i / 4) : "") } },
      y: { ...eixosEscuros, stacked: true, beginAtZero: true, title: { display: true, text: "motores por trimestre", color: "#a9b6c6" } },
    },
  },
});

const rotulosMes = Array.from({ length: dados.horizonte }, (_, m) => nomeMes(m));
const gReservas = new Chart($("#g-reservas"), {
  type: "line",
  data: {
    labels: rotulosMes,
    datasets: [
      { label: "futuro tranquilo (P10)", data: [], borderWidth: 0, pointRadius: 0, fill: false, stepped: true },
      { label: "Faixa de 9 em cada 10 futuros", data: [], borderWidth: 0, pointRadius: 0, fill: "-1",
        backgroundColor: "rgba(57,135,229,.22)", stepped: true },
      { label: "Caso típico (mediana)", data: [], borderColor: COR.azulEscuro, borderWidth: 2, pointRadius: 0, stepped: true },
    ],
  },
  options: {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { ...legenda("#a9b6c6"), labels: { ...legenda("#a9b6c6").labels, filter: (i) => i.datasetIndex > 0 } },
      tooltip: { filter: (i) => i.datasetIndex === 2,
        callbacks: { label: (c) => ` mediana: ${num(c.parsed.y)} · faixa: ${num(gReservas.data.datasets[0].data[c.dataIndex])}–${num(gReservas.data.datasets[1].data[c.dataIndex])}` } },
    },
    scales: {
      x: { ...eixosEscuros, grid: { display: false }, ticks: { ...eixosEscuros.ticks, autoSkip: false, maxRotation: 0,
        callback: (_, i) => (i % 12 === 0 ? String(anoIni + i / 12) : "") } },
      y: { ...eixosEscuros, beginAtZero: true, title: { display: true, text: "motores fora da asa", color: "#a9b6c6" } },
    },
  },
});

const gPoliticas = new Chart($("#g-politicas"), {
  type: "bar",
  data: {
    labels: ["Trocar cedo", "Aproveitar até o fim"],
    datasets: [
      { label: "Revisões", data: [], backgroundColor: COR.azul, borderRadius: 4, barThickness: 34 },
      { label: "Vida de peça jogada fora", data: [], backgroundColor: COR.laranja, borderRadius: 4, barThickness: 34 },
    ],
  },
  options: {
    indexAxis: "y", maintainAspectRatio: false,
    plugins: { legend: legenda("#4b5563"),
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: US$ ${num(c.parsed.x, 1)} mi` } } },
    scales: {
      x: { ...eixosClaros, stacked: true, beginAtZero: true,
        ticks: { ...eixosClaros.ticks, maxRotation: 0, maxTicksLimit: 5, callback: (v) => `US$ ${v} mi` } },
      y: { ...eixosClaros, stacked: true, grid: { display: false } },
    },
  },
});

const val = dados.etapas.validacao_margem;
new Chart($("#g-validacao"), {
  data: {
    labels: val.map((v) => v.motor.replace("CFM56-", "")),
    datasets: [
      { type: "bar", label: "Faixa publicada", data: val.map((v) => [v.margem_pub_min, v.margem_pub_max]),
        backgroundColor: "rgba(42,120,214,.28)", borderColor: COR.azul, borderWidth: 1, borderRadius: 4, barPercentage: 0.5,
        borderSkipped: false },
      { type: "line", label: "Previsão do modelo", data: val.map((v) => v.margem_prevista_c), showLine: false,
        pointRadius: 7, pointHoverRadius: 9, pointBackgroundColor: COR.laranja, pointBorderColor: "#fff", pointBorderWidth: 2 },
    ],
  },
  options: {
    maintainAspectRatio: false,
    plugins: { legend: legenda("#4b5563"),
      tooltip: { callbacks: { label: (c) => c.datasetIndex === 0
        ? ` publicado: ${c.raw[0]}–${c.raw[1]} °C` : ` modelo: ${num(c.parsed.y)} °C` } } },
    scales: {
      x: { ...eixosClaros, grid: { display: false } },
      y: { ...eixosClaros, min: 30, max: 160, title: { display: true, text: "folga do motor novo (°C)", color: "#4b5563" } },
    },
  },
});

// ================================================================ capítulo 4: simulador
const PADRAO = { capacidade: 2, ritmo: "normal", politica: "casada", tat: 2 };
const op = { ...PADRAO };
let custoRevisao = P.custo_revisao;
let mc = null, plano = null, politicas = null, cachePoliticas = "";

// controles segmentados: um clique escolhe uma opção e refaz as contas
function marcarControles() {
  document.querySelectorAll("[data-controle]").forEach((grupo) => {
    grupo.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.valor) === String(op[grupo.dataset.controle])));
  });
}
document.querySelectorAll("[data-controle]").forEach((grupo) => {
  grupo.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const chave = grupo.dataset.controle;
    op[chave] = ["capacidade", "tat"].includes(chave) ? Number(b.dataset.valor) : b.dataset.valor;
    marcarControles();
    recalcular();
  }));
});
$("#restaurar").addEventListener("click", () => { Object.assign(op, PADRAO); marcarControles(); recalcular(); });

// a frota: 50 aviõezinhos, cada um com 2 motores
$("#frota").innerHTML = Array.from({ length: nMotores / 2 }, (_, k) => aviaoSVG(k)).join("");
const pontos = [...document.querySelectorAll(".motor-ponto")];
const anel = `<svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#fff" stroke-dasharray="2 1.5"/></svg>`;
$("#legenda-frota").innerHTML = [
  [COR.bom, "Folga boa (mais de 30 °C)"], [COR.atencao, "Atenção (10–30 °C)"],
  [COR.critico, "Perto do limite (menos de 10 °C)"], [null, "Na fila da oficina"], [COR.oficina, "Na oficina"],
].map(([c, t]) => `<span>${c ? `<span class="ponto-status" style="background:${c}"></span>` : anel}${t}</span>`).join("");

let mesAtual = 0;
function desenharMes(m) {
  mesAtual = m;
  const foto = plano.fotos[m];
  let asa = 0, fila = 0, oficina = 0;
  pontos.forEach((p, i) => {
    const st = foto.status[i];
    p.classList.toggle("fila", st === NA_FILA);
    if (st === NA_OFICINA) { p.style.fill = COR.oficina; oficina++; }
    else if (st === NA_FILA) { fila++; }
    else { p.style.fill = estadoDaMargem(foto.margem[i]).cor; asa++; }
  });
  const feitas = plano.revisoes.filter((r) => r.entrada <= m).length;
  $("#mes").value = m;
  pintarSlider($("#mes"));
  $("#mes-txt").textContent = nomeMes(m);
  $("#contadores").innerHTML = `<span><b>${asa}</b>voando</span><span><b>${fila}</b>na fila</span>
    <span><b>${oficina}</b>na oficina</span><span><b>${feitas}</b>${feitas === 1 ? "revisão" : "revisões"} desde jan/${anoIni}</span>`;
}
$("#mes").addEventListener("input", (ev) => { pararPlay(); desenharMes(Number(ev.target.value)); });

let relogio = null;
function pararPlay() { clearInterval(relogio); relogio = null; $("#play").textContent = "▶"; $("#play").setAttribute("aria-label", "Reproduzir"); }
$("#play").addEventListener("click", () => {
  if (relogio) return pararPlay();
  if (mesAtual >= dados.horizonte - 1) desenharMes(0);
  $("#play").textContent = "❚❚"; $("#play").setAttribute("aria-label", "Pausar");
  relogio = setInterval(() => (mesAtual >= dados.horizonte - 1 ? pararPlay() : desenharMes(mesAtual + 1)), 140);
});

// dica ao passar o mouse num motor
const dica = $("#tooltip");
const versaoCurta = (v) => P.versoes[v].replace("CFM56-", "");
function mostrarDica(ev) {
  const i = Number(ev.target.dataset.motor);
  const foto = plano.fotos[mesAtual];
  const st = foto.status[i];
  const situacao = st === NA_OFICINA ? "Na oficina" : st === NA_FILA ? "Na fila da oficina"
    : `${estadoDaMargem(foto.margem[i]).txt}: ${num(Math.max(foto.margem[i], 0))} °C de folga`;
  const prox = plano.revisoes.find((r) => r.motor === i && r.remocao >= mesAtual);
  dica.innerHTML = `<b>${dados.frota.motor[i]}</b> · avião ${dados.frota.aviao[i]} · ${versaoCurta(dados.frota.versao[i])}<br>
    ${situacao}<br><span style="color:#4b5563">${prox ? `Próxima ida à oficina: ${nomeMes(prox.remocao)}` : "Sem revisão prevista no horizonte"}</span>`;
  dica.hidden = false;
  const r = ev.target.getBoundingClientRect();
  dica.style.left = `${Math.min(r.left + r.width / 2 - 120, innerWidth - 250)}px`;
  dica.style.top = `${r.bottom + 8}px`;
}
pontos.forEach((p) => {
  p.addEventListener("mouseenter", mostrarDica); p.addEventListener("focus", mostrarDica);
  p.addEventListener("mouseleave", () => (dica.hidden = true)); p.addEventListener("blur", () => (dica.hidden = true));
});
addEventListener("scroll", () => (dica.hidden = true), { passive: true });

function desenharKpis() {
  const custo = mc.revisoes * custoRevisao + mc.desperdicio;
  $("#kpis").innerHTML = `
    <div class="kpi"><b>${num(mc.revisoes)}</b><span>revisões em 10 anos</span><em>${num(mc.pctLlp)}% forçadas por peça vencida</em></div>
    <div class="kpi"><b>${num(mc.reservasP90)}</b><span>motores reserva</span><em>cobrem 9 em cada 10 futuros</em></div>
    <div class="kpi"><b>${num(mc.espera, 1)}</b><span>meses de espera na fila</span><em>em média, por motor</em></div>
    <div class="kpi"><b>${milhoes(custo, 0)}</b><span>custo em 10 anos</span><em>revisões + vida de peça jogada fora</em></div>`;
}

function desenharFila() {
  const motivo = { EGT: ["egt", "Folga acabou"], LLP: ["llp", "Peça venceu"], "EGT + LLP": ["llp", "Os dois"] };
  const linhas = plano.revisoes.slice(0, 12).map((r) => {
    const [cls, txt] = motivo[r.causa];
    return `<tr><td>${nomeMes(r.remocao)}</td><td><b>${dados.frota.motor[r.motor]}</b></td><td>${dados.frota.aviao[r.motor]}</td>
      <td>${versaoCurta(dados.frota.versao[r.motor])}</td><td class="motivo"><span class="etiqueta ${cls}">${txt}</span></td>
      <td>${num(Math.max(r.margem, 0), 1)} °C</td><td>${r.espera ? `${r.espera} ${r.espera > 1 ? "meses" : "mês"}` : "—"}</td>
      <td>${r.llps_trocadas.length ? r.llps_trocadas.join(", ") : "nenhuma"}</td></tr>`;
  }).join("");
  $("#fila").innerHTML = `<thead><tr><th>Sai da asa</th><th>Motor</th><th>Avião</th><th>Versão</th><th>Motivo</th>
    <th>Folga na saída</th><th>Espera</th><th>Peças com validade trocadas</th></tr></thead><tbody>${linhas}</tbody>`;
}

function desenharPoliticas() {
  const [a, b] = politicas;   // a = trocar cedo, b = aproveitar até o fim
  const custo = (x) => x.revisoes * custoRevisao + x.desperdicio;
  gPoliticas.data.datasets[0].data = [a, b].map((x) => (x.revisoes * custoRevisao) / 1e6);
  gPoliticas.data.datasets[1].data = [a, b].map((x) => x.desperdicio / 1e6);
  gPoliticas.update();
  const dif = custo(b) - custo(a);
  const virada = (a.desperdicio - b.desperdicio) / (b.revisoes - a.revisoes);
  $("#custo-txt").textContent = `US$ ${num(custoRevisao / 1e6, 2)} milhão`;
  $("#veredito").innerHTML = dif >= 0
    ? `<b>Trocar cedo economiza ${milhoes(dif)} (${num(100 * dif / custo(b))}%)</b>
       Joga fora mais vida de peça, mas evita ${num(b.revisoes - a.revisoes)} idas extras à oficina.
       A conta só vira se a revisão custar menos de <b style="display:inline;font-size:1em">${milhoes(virada, 2)}</b>.`
    : `<b>Aproveitar até o fim economiza ${milhoes(-dif)} (${num(-100 * dif / custo(a))}%)</b>
       Com revisões tão baratas, compensa usar cada peça até o fim, mesmo indo mais vezes à oficina.
       O ponto de virada é ${milhoes(virada, 2)} por revisão.`;
  $("#politica-numeros").innerHTML = [["Trocar cedo", a], ["Aproveitar até o fim", b]].map(([t, x]) =>
    `<div><b>${t}</b><br>${num(x.revisoes)} revisões · ${num(x.pctLlp)}% por peça vencida<br>
     ${milhoes(x.desperdicio)} de vida jogada fora</div>`).join("");
}

function recalcular() {
  document.body.classList.add("calculando");
  pararPlay();
  // setTimeout deixa o navegador mostrar o "calculando" antes das contas
  setTimeout(() => {
    mc = monteCarlo(dados, { ...op, custoRevisao }, N_FUTUROS);

    // cenário médio, sem sorteio: alimenta a linha do tempo e a fila
    const nominal = desgasteNominal(nMotores, P.tau);
    plano = simular(estadoInicial(dados, nominal), 0, dados.horizonte, nominal, criarRng(0), P,
                    { ...op, sortear: false, gravarFotos: true });

    // comparação de políticas: sem limite de vagas, para isolar o efeito da política
    const chave = `${op.ritmo}|${op.tat}`;
    if (chave !== cachePoliticas) {
      politicas = ["casada", "stub_minimo"].map((pol) =>
        monteCarlo(dados, { ...op, politica: pol, capacidade: null, custoRevisao }, N_FUTUROS, 7));
      cachePoliticas = chave;
    }

    const tri = (campo) => trimestres.map((_, t) => [0, 1, 2].reduce((s, k) => s + mc.remocoes[3 * t + k][campo], 0));
    gDemanda.data.datasets[0].data = tri("egt");
    gDemanda.data.datasets[1].data = tri("llp");
    gDemanda.data.datasets[2].data = trimestres.map(() => op.capacidade * 3);
    gDemanda.update();
    gReservas.data.datasets[0].data = mc.fora.map((f) => f.p10);
    gReservas.data.datasets[1].data = mc.fora.map((f) => f.p90);
    gReservas.data.datasets[2].data = mc.fora.map((f) => f.p50);
    gReservas.update();

    desenharKpis();
    desenharFila();
    desenharMes(0);
    desenharPoliticas();
    document.body.classList.remove("calculando");
  }, 30);
}

$("#custo").addEventListener("input", (ev) => {
  custoRevisao = Number(ev.target.value) * 1e6;
  desenharPoliticas();
  desenharKpis();
});

recalcular();
