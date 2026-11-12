// Idiomas do site: português (padrão, escrito direto no HTML) e inglês (dicionário EN abaixo).
//
// Como funciona:
//  - Cada texto traduzível do HTML tem um atributo data-i18n="chave".
//  - Na primeira troca, guardamos o português original (data-pt) e colocamos o texto de EN[chave].
//  - Para voltar ao português, usamos o texto guardado.
//  - Textos montados pelo JavaScript usam tr("português", "English"), com as duas versões lado a lado.

const IDIOMAS = ["pt", "en"];

function lerSalvo() {
  try { return localStorage.getItem("idioma"); } catch { return null; }
}

// Ordem de escolha: link (?lang=en) → escolha salva → idioma do navegador
const daUrl = new URLSearchParams(location.search).get("lang");
let idioma = IDIOMAS.includes(daUrl) ? daUrl
  : IDIOMAS.includes(lerSalvo()) ? lerSalvo()
  : (navigator.language || "pt").toLowerCase().startsWith("pt") ? "pt" : "en";

export const idiomaAtual = () => idioma;
export const tr = (pt, en) => (idioma === "en" ? en : pt);
export const localidade = () => (idioma === "en" ? "en-US" : "pt-BR");

export function definirIdioma(novo) {
  idioma = novo;
  try { localStorage.setItem("idioma", novo); } catch { /* navegação privada: só não lembra */ }
  const url = new URL(location.href);
  url.searchParams.set("lang", novo);
  history.replaceState(null, "", url);
}

export function traduzirPagina() {
  document.documentElement.lang = idioma === "en" ? "en" : "pt-BR";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.dataset.pt === undefined) el.dataset.pt = el.innerHTML;
    el.innerHTML = idioma === "en" ? (EN[el.dataset.i18n] ?? el.dataset.pt) : el.dataset.pt;
  });
  document.title = tr("Planejador de Revisão CFM56", "CFM56 Shop Visit Planner");
  document.querySelector('meta[name="description"]').content = tr(
    "Quando um motor de avião precisa ir para a oficina? Simulador interativo de revisões do motor CFM56-7B, com dados públicos e uma frota fictícia.",
    "When does an aircraft engine need to go to the shop? Interactive shop visit simulator for the CFM56-7B engine, using public data and a fictional fleet.");
  document.querySelectorAll(".idioma button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === idioma)));
}

// ---------------------------------------------------------------- textos em inglês
export const EN = {
  marca: "Planner",
  nav1: "The engine", nav2: "The margin", nav3: "Simulator", nav4: "Replace early?", nav5: "How it was made",
  selo: "Study project · public data · fictional fleet",
  h1: "When does an aircraft engine need to go to the <em>shop</em>?",
  lead: `An aircraft engine does not break down all of a sudden: it loses margin little by little, with every takeoff.
    This site shows how to predict <strong>when</strong> each engine in a fleet will need a shop visit,
    and how a shop plans to receive all of them.`,
  cta1: "Understand it in 3 minutes", cta2: "Go straight to the simulator",
  fato1: "the engine of the Boeing 737 NG", fato2b: "100 engines", fato2: "in an invented fleet",
  fato3b: "10 years", fato3: "of simulated future, month by month",

  cap1: "Chapter 1", c1h2: "The engine in 4 steps",
  c1intro: "Tap the numbers on the drawing. Every jet engine does the same thing: <strong>suck, squeeze, bang and blow</strong>.",
  ficha1b: "1.55 m", ficha1: "fan diameter", ficha2: "air around × through the core",
  ficha3b: "19.5 to 27.3k", ficha3: "pounds of thrust", ficha4b: "15,183 rpm", ficha4: "max. high-pressure spool speed",
  p1h: "Suck",
  p1: `The <b>fan</b>, the big propeller at the front, pulls in a huge amount of air. About <b>5 out of every 6 parts</b>
    go around the engine core (the "bypass") and leave at the back, pushing the aircraft. That is where most of the
    thrust comes from, and also why the engine is efficient and quieter.`,
  p2h: "Squeeze",
  p2: `The air that enters the core goes through <b>12 rows of blades</b> that squeeze it until it is <b>21 to 29 times</b>
    more compressed, depending on the version. Compressed air burns better, like in a pressure cooker.`,
  p3h: "Bang",
  p3: `In the <b>combustor</b>, jet fuel is burned in that air. The gas goes above <b>1,100 °C</b>. The parts right after the
    combustor only survive because they have ceramic coatings and are cooled from the inside with air.`,
  p4h: "Blow",
  p4: `The hot gas spins the <b>turbines</b>, which drive the compressor and the fan through shafts. Inside the turbine,
    a sensor measures the gas temperature: the <b>EGT</b>. It is the engine's "health thermometer".`,

  cap2: "Chapter 2", c2h2: "The temperature margin",
  c2intro: `Every engine has a <b>maximum temperature</b> it cannot exceed. A new engine runs well below it.
    That distance is the <b>EGT margin</b>. As the engine wears, it has to run hotter to give the same thrust,
    and the margin shrinks with every flight.`,
  atleta: `💡 <b>Think of an athlete:</b> over the years, to run at the same pace, the heart has to beat faster.
    When it reaches its maximum, it is time for a check-up. In the engine, the "racing heart" is the temperature.`,
  versaoRot: "Engine version <small>more thrust means less margin from new</small>",
  lbf24: "24k lbf", lbf26: "26k lbf", lbf27: "27k lbf",
  ciclosRot: "Takeoffs since new (cycles):",
  regua20: "<span>new</span><span>5k</span><span>10k</span><span>15k</span><span>20k</span>",
  fx1: "<b>Good margin</b> · above 30 °C", fx1e: "Flies normally; the airline just watches the trend.",
  fx2: "<b>Watch</b> · 10 to 30 °C", fx2e: "Planning already books a slot at the shop.",
  fx3: "<b>Near the limit</b> · below 10 °C", fx3e: "The engine comes off the wing at the next opportunity.",
  painel: "Engine panel",
  curvaTit: "Margin over the engine's life <span>● you are here</span>",

  cap3: "Chapter 3", c3h2: "Two clocks take the engine off the wing",
  c3intro: "The engine goes to the shop when the <b>first</b> clock runs out.",
  r1h: "Clock 1: the temperature margin",
  r1: `It drops a little with every takeoff: fast in the first ~1,000 flights (parts "bed in") and slowly after that
    (erosion from dust and sand). When the margin is gone, the engine can no longer take off at full thrust on a hot
    day without going over the limit.`,
  r1f: "Published rate: 11–15 °C in the first 1,000 cycles and 4–6 °C per 1,000 after that.",
  r2h: "Clock 2: parts with an expiry date",
  r2: `The disks and shafts that spin at up to <b>15,000 revolutions per minute</b> suffer a little fatigue with every
    takeoff. For safety, each one has a <b>maximum life</b>, counted in cycles, and must be replaced when it gets there,
    even if it looks perfect. These are the <b>LLPs</b> (<i>life limited parts</i>).`,
  llp1: "Core (high-pressure compressor and turbine)", llp2: "Low-pressure turbine", llp3: "Fan and booster",
  m20: "20k", m25: "25k", m30: "30k",
  corridaH: "Which clock runs out first?",
  corridaSub: "How many cycles each clock lasts on a new engine, with average wear.",

  cap4: "Chapter 4 · Interactive", c4h2: "You are the shop planner",
  c4intro: `An <b>invented</b> airline has 50 Boeing 737s (100 engines). Change the options and see, over the next 10 years,
    how many engines arrive at the shop, how long they wait and how many spare engines the airline needs so its aircraft
    are not grounded.`,
  ctl1: "Engines the shop takes in per month <small>More slots cost more (people, benches, tools).</small>",
  ctl2: "Wear rate <small>Heat, dust and short flights wear the engine faster.</small>",
  ctl3: "Life limited parts, at the shop visit <small>Replace them now, or use them to the end? (see chapter 5)</small>",
  ctl4: "Months the engine stays in the shop <small>Strip, inspect, repair and test.</small>",
  lento: "Slower", normal: "Normal", rapido: "Faster", cedo: "Replace early", fim: "Use to the end",
  restaurar: "Back to default",
  notaCtl: `Each change reruns <b>200 possible futures</b> (Monte Carlo method), because nobody knows the exact wear rate
    of each engine.`,
  frotaH: "The fleet month by month",
  frotaSub: "Each aircraft has 2 engines. Hover over (or tap) an engine to see the details.",
  demH: "How many engines arrive at the shop",
  demSub: "Average of the 200 futures, per quarter. The dashed line is how many the shop can take in.",
  resH: "Spare engines needed",
  resSub: `Engines off the wing (in the queue or in the shop). The line is the typical case; the band goes from the calmest
    future to the tightest one (9 out of 10 futures stay inside it).`,
  filaH: "Shop induction queue",
  filaSub: "Next 12 engines, in the average scenario, with the options you chose.",

  cap5: "Chapter 5", c5h2: "Replace the part early or use it to the end?",
  c5intro: `With the engine open at the shop, a part still has, say, 7,000 flights of life, but the engine will fly about
    13,000 more. Replacing it now throws away good life. Not replacing it forces the engine off the wing again,
    halfway through, just because of that part.`,
  dilH: "The dilemma in one picture",
  dilSub: `The engine has just left the shop. A core part (20,000-cycle life) has already flown 13,000, so 7,000 are left.
    The restored temperature margin is good for about 13,000 more.`,
  dil1r: "<b>Old part</b><span>how long it still lasts</span>", dil1: "7k left",
  dil2r: "<b>Engine margin</b><span>how long the engine lasts</span>", dil2: "good for 13k more",
  dil3r: "<b>Replace early</b><span>new part now</span>", dil3: "engine flies 13k cycles, until the margin runs out",
  dil3c: "7k cycles of part thrown away ≈ US$ 0.46M",
  dil4r: "<b>Use to the end</b><span>old part stays</span>", dil4a: "flies 7k", dil4b: "returns, flies 6k more",
  dil4c: "1 extra shop visit ≈ US$ 1.7M",
  dilEixo: "<span>shop visit</span><span>5k</span><span>10k</span><span>15k</span><span>20k cycles later</span>",
  correia: `🚗 <b>It is like a car's timing belt:</b> if the mechanic has already opened the engine for another job and the belt
    is near the end of its life, it is worth replacing it too, because opening the engine again just for the belt costs
    more than the life that was left.`,
  custoRot: "Cost of one shop visit (without the parts):",
  reguaCusto: "<span>US$ 0.6M</span><span>source: 1.6–1.85</span><span>US$ 2.6M</span>",
  custoH: "Cost over 10 years",
  custoSub: "Shop visits + part life thrown away. Average of 200 futures, no slot limit, with the wear rate chosen in the simulator.",

  cap6: "Behind the scenes", c6h2: "How it was made",
  c6intro: `All in Python, with public data. Each step was checked against numbers published by shops and airlines
    before moving on to the next one.`,
  et1: "<b>1 · Public data</b><p>Fuel flow and thrust for 33 versions of the CFM56-7B, from the ICAO emissions databank.</p>",
  et2: `<b>2 · Physics model</b><p>Thermodynamic simulation of the engine (fan, compressors, combustor, turbines). Calibrated on one
    version, it predicted the margin of the other five with a mean error of 10 °C.</p>`,
  et3: `<b>3 · Wear</b><p>How much the temperature rises when each part loses efficiency, and how many cycles the engine lasts.
    It matches the intervals reported by TAP M&amp;E.</p>`,
  et4: "<b>4 · Fleet and shop</b><p>Month-by-month simulation of 100 engines with the two clocks, Monte Carlo and a policy comparison.</p>",
  et5: `<b>5 · This site</b><p>The simulator was translated to JavaScript and runs in your browser. An automated test checks
    that it gives exactly the same result as the Python code.</p>`,
  valH: "Does the physics model get each version's margin right?",
  valSub: "Bar = range published by shops. Dot = model prediction (calibrated only on the 7B24).",
  naoH: "What this project is <u>not</u>",
  naoLista: `<li><b>It does not use data from GE, CFM or any shop.</b> Only public sources: ICAO/EASA, the UK aviation
      authority (CAA) type certificate and trade magazines (Aircraft Commerce no. 39, 58 and 87).</li>
    <li><b>The fleet is invented.</b> Aircraft, engines and dates do not exist.</li>
    <li>Every shop visit has the same cost; the 18 life limited parts were grouped into 3 modules.</li>
    <li>Shop time and monthly slots are assumptions; there are no unexpected failures (such as bird strikes).</li>
    <li>2013 list prices: useful to compare choices, not as current values.</li>`,
  glossH: "Glossary",
  gloss: `<dt>EGT</dt><dd>Exhaust gas temperature, measured inside the low-pressure turbine.</dd>
    <dt>EGT margin</dt><dd>How far the EGT is from the limit during a takeoff on a hot day.</dd>
    <dt>Cycle (EFC)</dt><dd>One complete flight: start, takeoff, landing, shutdown. Wear is counted in cycles.</dd>
    <dt>LLP</dt><dd>Life limited part: a disk or shaft that must be replaced when it reaches a number of cycles.</dd>
    <dt>Shop visit</dt><dd>When the engine is removed from the aircraft and sent to the shop to be stripped and restored.</dd>
    <dt>Spare engine</dt><dd>An extra engine the airline installs on the aircraft while the original is at the shop.</dd>
    <dt>Monte Carlo</dt><dd>Running the simulation many times, each with a different random draw, to see the range of possible results.</dd>
    <dt>Bypass</dt><dd>The air the fan pushes around the engine core. On the CFM56-7B, about 5 times the air that goes through it.</dd>`,
  rodape: `Study project by Asafe Ferreira, Computer Engineering.<br>
    Public data · fictional fleet · no data from GE, CFM or Celma.`,
  github: "Code on GitHub",
};
