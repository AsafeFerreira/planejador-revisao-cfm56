// Liga a página: arte, explicações interativas, simulador, gráficos e linha do tempo.
// As contas ficam em simulador.js (tradução fiel do Python); aqui é só interface.
// Textos em dois idiomas: tr("português", "English"), de i18n.js.
import { ICONES, aviaoSVG, curvaFolgaSVG, motorSVG, mostradorSVG } from "./arte.js";
import { definirIdioma, idiomaAtual, localidade, tr, traduzirPagina } from "./i18n.js";
import { NA_FILA, NA_OFICINA, criarRng, desgasteNominal, estadoInicial, monteCarlo, simular } from "./simulador.js";

const MESES = {
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const LIMITE_REAL = [908, 920, 920];     // limite real de EGT do 7B24/26/27, °C (Aircraft Commerce nº 58)
const CICLOS_POR_ANO = 1700;             // ~3.100 h de voo por ano ÷ 1,9 h por ciclo (AC58)
const N_FUTUROS = 200;
const COR = {
  bom: "#0ca30c", atencao: "#fab219", critico: "#d03b3b", oficina: "#3987e5",
  azul: "#2a78d6", laranja: "#eb6834", azulEscuro: "#3987e5", laranjaEscuro: "#f07a45",
};
// nomes dos grupos de LLP vêm do Python em português
const GRUPO_EN = { "Fan/booster": "Fan/booster", "Núcleo (HPC+HPT)": "Core (HPC+HPT)", LPT: "LPT" };

const $ = (s) => document.querySelector(s);
// números no formato do idioma: 1.234,5 (pt) ou 1,234.5 (en)
const num = (x, casas = 0) => x.toLocaleString(localidade(), { minimumFractionDigits: casas, maximumFractionDigits: casas });
const milhoes = (usd, casas = 1) => tr(`US$ ${num(usd / 1e6, casas)} mi`, `US$ ${num(usd / 1e6, casas)}M`);

function estadoDaMargem(m) {
  if (m > 30) return { cor: COR.bom, txt: tr("Folga boa", "Good margin") };
  if (m > 10) return { cor: COR.atencao, txt: tr("Atenção", "Watch") };
  return { cor: COR.critico, txt: m > 0 ? tr("Perto do limite", "Near the limit") : tr("Folga acabou", "Margin gone") };
}

const dados = await (await fetch("dados.json")).json();
const P = dados.parametros;
const [anoIni, mesIni] = dados.inicio.split("-").map(Number);
const nomeMes = (m) => {
  const t = anoIni * 12 + (mesIni - 1) + m, nome = MESES[idiomaAtual()][t % 12], ano = Math.floor(t / 12);
  return tr(`${nome}/${ano}`, `${nome} ${ano}`);
};
const nMotores = dados.frota.util.length;

traduzirPagina();   // aplica o idioma escolhido antes de desenhar o resto

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
  $("#cabine-folga").innerHTML = `<span class="ponto-status" style="background:${est.cor}"></span>` + tr(
    `folga <b>${num(Math.max(margem, 0))} °C</b> até o limite de ${limite} °C · ${est.txt}`,
    `margin <b>${num(Math.max(margem, 0))} °C</b> to the ${limite} °C limit · ${est.txt}`);
  $("#folga-leitura").innerHTML = `
    <div><b>${num(Math.max(margem, 0))} °C</b><span>${tr("folga até o limite", "margin to the limit")}</span></div>
    <div><b>${num(egt)} °C</b><span>${tr("EGT na decolagem em dia quente", "takeoff EGT on a hot day")}</span></div>
    <div><b>~${num(vida / CICLOS_POR_ANO, 0)} ${tr("anos", "years")}</b><span>${tr(
      `na asa até a folga acabar (${num(vida)} ciclos)`, `on wing until the margin runs out (${num(vida)} cycles)`)}</span></div>`;
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
let versaoCorrida = 0;
function desenharCorrida(v = versaoCorrida) {
  versaoCorrida = v;
  const [lo, hi] = P.margem_nova[v];
  const egt = ciclosAteZerar((lo + hi) / 2);
  const relogios = [
    { nome: tr("Folga de temperatura", "Temperature margin"), sub: tr("margem de EGT", "EGT margin"), ciclos: egt, tipo: "egt" },
    { nome: tr("Peças do núcleo", "Core parts"), sub: tr("compressor e turbina de alta", "high-pressure compressor and turbine"), ciclos: P.vida_llp[1], tipo: "llp" },
    { nome: tr("Peças da turbina de baixa", "Low-pressure turbine parts"), sub: tr("LLPs da LPT", "LPT LLPs"), ciclos: P.vida_llp[2], tipo: "llp" },
    { nome: tr("Peças do fan e booster", "Fan and booster parts"), sub: tr("LLPs do fan", "fan LLPs"), ciclos: P.vida_llp[0], tipo: "llp" },
  ];
  const vence = Math.min(...relogios.map((r) => r.ciclos));
  const ESCALA = 32000, pct = (n) => (100 * n) / ESCALA;
  $("#corrida").innerHTML = relogios.map((r) => `
    <div class="corrida-rotulo"><b>${r.nome}${r.ciclos === vence ? ` <em class="selo-vence">${tr("zera primeiro", "runs out first")}</em>` : ""}</b><span>${r.sub}</span></div>
    <div class="corrida-trilho">
      <i class="barra ${r.tipo} ${r.ciclos === vence ? "vence" : ""}" style="width:${pct(r.ciclos)}%"></i>
      <span class="valor ${pct(r.ciclos) > 78 ? "dentro" : ""}" style="left:${pct(r.ciclos)}%">${num(r.ciclos)}</span>
      <i class="linha-revisao" style="left:${pct(vence)}%"></i>
    </div>`).join("");
  const quem = relogios.find((r) => r.ciclos === vence);
  const folgaLlp = P.vida_llp[1] - egt;
  const extra = quem.tipo === "egt" && folgaLlp < 3000
    ? tr(`As peças do núcleo venceriam só ${num(folgaLlp)} ciclos depois: é por isso que muitos 7B24 saem por um motivo ou pelo outro.`,
         `The core parts would expire only ${num(folgaLlp)} cycles later: that is why many 7B24s come off for one reason or the other.`)
    : quem.tipo === "egt"
      ? tr("As peças com validade ainda teriam bastante vida: é o motor de alta potência que gasta a folga mais cedo.",
           "The life limited parts would still have plenty of life: it is the high-thrust engine that uses up its margin sooner.")
      : "";
  $("#corrida-conclusao").innerHTML = `🔧 ` + tr(
    `<b>Primeira revisão aos ${num(vence)} ciclos, cerca de ${num(vence / CICLOS_POR_ANO)} anos</b>, porque ${quem.tipo === "egt" ? "a folga de temperatura acaba" : "uma peça chega ao limite"} primeiro. `,
    `<b>First shop visit at ${num(vence)} cycles, about ${num(vence / CICLOS_POR_ANO)} years</b>, because ${quem.tipo === "egt" ? "the temperature margin runs out" : "a part reaches its limit"} first. `) + extra;
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
const nTrimestres = dados.horizonte / 3;
const rotulosTrimestre = () => Array.from({ length: nTrimestres }, (_, t) => `${anoIni + Math.floor(t / 4)} ${tr("T", "Q")}${(t % 4) + 1}`);
const rotulosMes = () => Array.from({ length: dados.horizonte }, (_, m) => nomeMes(m));

const gDemanda = new Chart($("#g-demanda"), {
  type: "bar",
  data: {
    labels: rotulosTrimestre(),
    datasets: [
      { label: "", data: [], backgroundColor: COR.azulEscuro, borderRadius: 3, stack: "r" },
      { label: "", data: [], backgroundColor: COR.laranjaEscuro, borderRadius: 3, stack: "r" },
      { label: "", data: [], type: "line", borderColor: "#eef2f7", borderDash: [6, 5],
        borderWidth: 1.5, pointRadius: 0, stack: "cap" },
    ],
  },
  options: {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: legenda("#a9b6c6"),
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${num(c.parsed.y, 1)} ${tr("motores", "engines")}` } } },
    scales: {
      x: { ...eixosEscuros, stacked: true, grid: { display: false }, ticks: { ...eixosEscuros.ticks, autoSkip: false, maxRotation: 0,
        callback: (_, i) => (i % 4 === 0 ? String(anoIni + i / 4) : "") } },
      y: { ...eixosEscuros, stacked: true, beginAtZero: true, title: { display: true, text: "", color: "#a9b6c6" } },
    },
  },
});

const gReservas = new Chart($("#g-reservas"), {
  type: "line",
  data: {
    labels: rotulosMes(),
    datasets: [
      { label: "P10", data: [], borderWidth: 0, pointRadius: 0, fill: false, stepped: true },
      { label: "", data: [], borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: "rgba(57,135,229,.22)", stepped: true },
      { label: "", data: [], borderColor: COR.azulEscuro, borderWidth: 2, pointRadius: 0, stepped: true },
    ],
  },
  options: {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { ...legenda("#a9b6c6"), labels: { ...legenda("#a9b6c6").labels, filter: (i) => i.datasetIndex > 0 } },
      tooltip: { filter: (i) => i.datasetIndex === 2,
        callbacks: { label: (c) => ` ${tr("mediana", "median")}: ${num(c.parsed.y)} · ${tr("faixa", "band")}: ${num(gReservas.data.datasets[0].data[c.dataIndex])}–${num(gReservas.data.datasets[1].data[c.dataIndex])}` } },
    },
    scales: {
      x: { ...eixosEscuros, grid: { display: false }, ticks: { ...eixosEscuros.ticks, autoSkip: false, maxRotation: 0,
        callback: (_, i) => (i % 12 === 0 ? String(anoIni + i / 12) : "") } },
      y: { ...eixosEscuros, beginAtZero: true, title: { display: true, text: "", color: "#a9b6c6" } },
    },
  },
});

const gPoliticas = new Chart($("#g-politicas"), {
  type: "bar",
  data: {
    labels: ["", ""],
    datasets: [
      { label: "", data: [], backgroundColor: COR.azul, borderRadius: 4, barThickness: 34 },
      { label: "", data: [], backgroundColor: COR.laranja, borderRadius: 4, barThickness: 34 },
    ],
  },
  options: {
    indexAxis: "y", maintainAspectRatio: false,
    plugins: { legend: legenda("#4b5563"),
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${milhoes(c.parsed.x * 1e6)}` } } },
    scales: {
      x: { ...eixosClaros, stacked: true, beginAtZero: true,
        ticks: { ...eixosClaros.ticks, maxRotation: 0, maxTicksLimit: 5, callback: (v) => milhoes(v * 1e6, 0) } },
      y: { ...eixosClaros, stacked: true, grid: { display: false } },
    },
  },
});

const val = dados.etapas.validacao_margem;
const gValidacao = new Chart($("#g-validacao"), {
  data: {
    labels: val.map((v) => v.motor.replace("CFM56-", "")),
    datasets: [
      { type: "bar", label: "", data: val.map((v) => [v.margem_pub_min, v.margem_pub_max]),
        backgroundColor: "rgba(42,120,214,.28)", borderColor: COR.azul, borderWidth: 1, borderRadius: 4, barPercentage: 0.5,
        borderSkipped: false },
      { type: "line", label: "", data: val.map((v) => v.margem_prevista_c), showLine: false,
        pointRadius: 7, pointHoverRadius: 9, pointBackgroundColor: COR.laranja, pointBorderColor: "#fff", pointBorderWidth: 2 },
    ],
  },
  options: {
    maintainAspectRatio: false,
    plugins: { legend: legenda("#4b5563"),
      tooltip: { callbacks: { label: (c) => c.datasetIndex === 0
        ? ` ${tr("publicado", "published")}: ${c.raw[0]}–${c.raw[1]} °C` : ` ${tr("modelo", "model")}: ${num(c.parsed.y)} °C` } } },
    scales: {
      x: { ...eixosClaros, grid: { display: false } },
      y: { ...eixosClaros, min: 30, max: 160, title: { display: true, text: "", color: "#4b5563" } },
    },
  },
});

// textos dos gráficos (rótulos, legendas, eixos) no idioma atual
function textosGraficos() {
  const d = gDemanda.data.datasets;
  d[0].label = tr("Folga de temperatura acabou", "Temperature margin ran out");
  d[1].label = tr("Peça com validade venceu", "Life limited part expired");
  d[2].label = tr("Capacidade da oficina", "Shop capacity");
  gDemanda.data.labels = rotulosTrimestre();
  gDemanda.options.scales.y.title.text = tr("motores por trimestre", "engines per quarter");
  const r = gReservas.data.datasets;
  r[1].label = tr("Faixa de 9 em cada 10 futuros", "Band of 9 out of 10 futures");
  r[2].label = tr("Caso típico (mediana)", "Typical case (median)");
  gReservas.data.labels = rotulosMes();
  gReservas.options.scales.y.title.text = tr("motores fora da asa", "engines off the wing");
  gPoliticas.data.labels = [tr("Trocar cedo", "Replace early"), tr("Aproveitar até o fim", "Use to the end")];
  gPoliticas.data.datasets[0].label = tr("Revisões", "Shop visits");
  gPoliticas.data.datasets[1].label = tr("Vida de peça jogada fora", "Part life thrown away");
  gValidacao.data.datasets[0].label = tr("Faixa publicada", "Published range");
  gValidacao.data.datasets[1].label = tr("Previsão do modelo", "Model prediction");
  gValidacao.options.scales.y.title.text = tr("folga do motor novo (°C)", "new engine margin (°C)");
  [gDemanda, gReservas, gPoliticas, gValidacao].forEach((g) => g.update());
}
textosGraficos();

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
function desenharLegendaFrota() {
  $("#legenda-frota").innerHTML = [
    [COR.bom, tr("Folga boa (mais de 30 °C)", "Good margin (above 30 °C)")],
    [COR.atencao, tr("Atenção (10–30 °C)", "Watch (10–30 °C)")],
    [COR.critico, tr("Perto do limite (menos de 10 °C)", "Near the limit (below 10 °C)")],
    [null, tr("Na fila da oficina", "In the shop queue")],
    [COR.oficina, tr("Na oficina", "In the shop")],
  ].map(([c, t]) => `<span>${c ? `<span class="ponto-status" style="background:${c}"></span>` : anel}${t}</span>`).join("");
}
desenharLegendaFrota();

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
  $("#contadores").innerHTML = `<span><b>${asa}</b>${tr("voando", "flying")}</span><span><b>${fila}</b>${tr("na fila", "in queue")}</span>
    <span><b>${oficina}</b>${tr("na oficina", "in the shop")}</span><span><b>${feitas}</b>${tr(
      `${feitas === 1 ? "revisão" : "revisões"} desde ${nomeMes(0)}`, `shop ${feitas === 1 ? "visit" : "visits"} since ${nomeMes(0)}`)}</span>`;
}
$("#mes").addEventListener("input", (ev) => { pararPlay(); desenharMes(Number(ev.target.value)); });

let relogio = null;
function pararPlay() {
  clearInterval(relogio); relogio = null;
  $("#play").textContent = "▶"; $("#play").setAttribute("aria-label", tr("Reproduzir", "Play"));
}
$("#play").addEventListener("click", () => {
  if (relogio) return pararPlay();
  if (mesAtual >= dados.horizonte - 1) desenharMes(0);
  $("#play").textContent = "❚❚"; $("#play").setAttribute("aria-label", tr("Pausar", "Pause"));
  relogio = setInterval(() => (mesAtual >= dados.horizonte - 1 ? pararPlay() : desenharMes(mesAtual + 1)), 140);
});

// dica ao passar o mouse num motor
const dica = $("#tooltip");
const versaoCurta = (v) => P.versoes[v].replace("CFM56-", "");
function mostrarDica(ev) {
  const i = Number(ev.target.dataset.motor);
  const foto = plano.fotos[mesAtual];
  const st = foto.status[i];
  const situacao = st === NA_OFICINA ? tr("Na oficina", "In the shop") : st === NA_FILA ? tr("Na fila da oficina", "In the shop queue")
    : `${estadoDaMargem(foto.margem[i]).txt}: ${num(Math.max(foto.margem[i], 0))} °C ${tr("de folga", "of margin")}`;
  const prox = plano.revisoes.find((r) => r.motor === i && r.remocao >= mesAtual);
  dica.innerHTML = `<b>${dados.frota.motor[i]}</b> · ${tr("avião", "aircraft")} ${dados.frota.aviao[i]} · ${versaoCurta(dados.frota.versao[i])}<br>
    ${situacao}<br><span style="color:#4b5563">${prox
      ? tr(`Próxima ida à oficina: ${nomeMes(prox.remocao)}`, `Next shop visit: ${nomeMes(prox.remocao)}`)
      : tr("Sem revisão prevista no horizonte", "No shop visit expected in the horizon")}</span>`;
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
    <div class="kpi"><b>${num(mc.revisoes)}</b><span>${tr("revisões em 10 anos", "shop visits in 10 years")}</span>
      <em>${tr(`${num(mc.pctLlp)}% forçadas por peça vencida`, `${num(mc.pctLlp)}% forced by an expired part`)}</em></div>
    <div class="kpi"><b>${num(mc.reservasP90)}</b><span>${tr("motores reserva", "spare engines")}</span>
      <em>${tr("cobrem 9 em cada 10 futuros", "cover 9 out of 10 futures")}</em></div>
    <div class="kpi"><b>${num(mc.espera, 1)}</b><span>${tr("meses de espera na fila", "months waiting in queue")}</span>
      <em>${tr("em média, por motor", "on average, per engine")}</em></div>
    <div class="kpi"><b>${milhoes(custo, 0)}</b><span>${tr("custo em 10 anos", "cost over 10 years")}</span>
      <em>${tr("revisões + vida de peça jogada fora", "shop visits + part life thrown away")}</em></div>`;
}

function desenharFila() {
  const motivo = {
    EGT: ["egt", tr("Folga acabou", "Margin gone")],
    LLP: ["llp", tr("Peça venceu", "Part expired")],
    "EGT + LLP": ["llp", tr("Os dois", "Both")],
  };
  const grupo = (g) => tr(g, GRUPO_EN[g] ?? g);
  const linhas = plano.revisoes.slice(0, 12).map((r) => {
    const [cls, txt] = motivo[r.causa];
    const espera = r.espera ? `${r.espera} ${r.espera > 1 ? tr("meses", "months") : tr("mês", "month")}` : "—";
    return `<tr><td>${nomeMes(r.remocao)}</td><td><b>${dados.frota.motor[r.motor]}</b></td><td>${dados.frota.aviao[r.motor]}</td>
      <td>${versaoCurta(dados.frota.versao[r.motor])}</td><td class="motivo"><span class="etiqueta ${cls}">${txt}</span></td>
      <td>${num(Math.max(r.margem, 0), 1)} °C</td><td>${espera}</td>
      <td>${r.llps_trocadas.length ? r.llps_trocadas.map(grupo).join(", ") : tr("nenhuma", "none")}</td></tr>`;
  }).join("");
  const cab = tr(["Sai da asa", "Motor", "Avião", "Versão", "Motivo", "Folga na saída", "Espera", "Peças com validade trocadas"],
                 ["Off wing", "Engine", "Aircraft", "Version", "Reason", "Margin at removal", "Wait", "Life limited parts replaced"]);
  $("#fila").innerHTML = `<thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas}</tbody>`;
}

function desenharPoliticas() {
  const [a, b] = politicas;   // a = trocar cedo, b = aproveitar até o fim
  const custo = (x) => x.revisoes * custoRevisao + x.desperdicio;
  gPoliticas.data.datasets[0].data = [a, b].map((x) => (x.revisoes * custoRevisao) / 1e6);
  gPoliticas.data.datasets[1].data = [a, b].map((x) => x.desperdicio / 1e6);
  gPoliticas.update();
  const dif = custo(b) - custo(a);
  const virada = (a.desperdicio - b.desperdicio) / (b.revisoes - a.revisoes);
  const destaque = (t) => `<b style="display:inline;font-size:1em">${t}</b>`;
  $("#custo-txt").textContent = tr(`US$ ${num(custoRevisao / 1e6, 2)} milhão`, `US$ ${num(custoRevisao / 1e6, 2)} million`);
  $("#veredito").innerHTML = dif >= 0
    ? tr(`<b>Trocar cedo economiza ${milhoes(dif)} (${num(100 * dif / custo(b))}%)</b>
         Joga fora mais vida de peça, mas evita ${num(b.revisoes - a.revisoes)} idas extras à oficina.
         A conta só vira se a revisão custar menos de ${destaque(milhoes(virada, 2))}.`,
         `<b>Replacing early saves ${milhoes(dif)} (${num(100 * dif / custo(b))}%)</b>
         It throws away more part life, but avoids ${num(b.revisoes - a.revisoes)} extra trips to the shop.
         The answer only flips if a shop visit costs less than ${destaque(milhoes(virada, 2))}.`)
    : tr(`<b>Aproveitar até o fim economiza ${milhoes(-dif)} (${num(-100 * dif / custo(a))}%)</b>
         Com revisões tão baratas, compensa usar cada peça até o fim, mesmo indo mais vezes à oficina.
         O ponto de virada é ${milhoes(virada, 2)} por revisão.`,
         `<b>Using parts to the end saves ${milhoes(-dif)} (${num(-100 * dif / custo(a))}%)</b>
         With shop visits this cheap, it pays to use each part to the end, even with more trips to the shop.
         The break-even point is ${milhoes(virada, 2)} per shop visit.`);
  $("#politica-numeros").innerHTML = [[tr("Trocar cedo", "Replace early"), a], [tr("Aproveitar até o fim", "Use to the end"), b]]
    .map(([t, x]) => `<div><b>${t}</b><br>${tr(
      `${num(x.revisoes)} revisões · ${num(x.pctLlp)}% por peça vencida<br>${milhoes(x.desperdicio)} de vida jogada fora`,
      `${num(x.revisoes)} shop visits · ${num(x.pctLlp)}% from an expired part<br>${milhoes(x.desperdicio)} of life thrown away`)}</div>`).join("");
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

    const tri = (campo) => Array.from({ length: nTrimestres }, (_, t) => [0, 1, 2].reduce((s, k) => s + mc.remocoes[3 * t + k][campo], 0));
    gDemanda.data.datasets[0].data = tri("egt");
    gDemanda.data.datasets[1].data = tri("llp");
    gDemanda.data.datasets[2].data = Array(nTrimestres).fill(op.capacidade * 3);
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

// ================================================================ troca de idioma
// Não refaz as contas: só redesenha os textos com os resultados que já existem.
function aplicarIdioma(novo) {
  definirIdioma(novo);
  traduzirPagina();
  textosGraficos();
  desenharFolga();
  desenharCorrida();
  desenharLegendaFrota();
  pararPlay();
  if (mc) { desenharKpis(); desenharFila(); desenharMes(mesAtual); desenharPoliticas(); }
}
document.querySelectorAll(".idioma button").forEach((b) =>
  b.addEventListener("click", () => { if (b.dataset.lang !== idiomaAtual()) aplicarIdioma(b.dataset.lang); }));
