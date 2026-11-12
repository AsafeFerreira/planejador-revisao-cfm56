// Arte do site, desenhada em SVG (vetor): escala sem perder qualidade e não pesa nada.
import { localidade, tr } from "./i18n.js";

// ------------------------------------------------------------ motor em corte
// Vista lateral de um turbofan de dois eixos. Desenhamos só a metade de cima e
// espelhamos (o motor é simétrico em torno da linha de centro, y = 150).
// Cores: azul = ar frio na entrada; laranja/vermelho = gás quente depois da câmara.

const SUPERIOR = (pts) => pts.map(([x, y]) => `${x},${y}`).join(" ");

// Linha externa do caminho do gás no núcleo e o "cubo" (parte central)
const NUCLEO_EXT = [[170,112],[215,110],[235,112],[330,128],[345,120],[385,120],[400,126],[420,122],[500,104],[600,120]];
const NUCLEO_INT = [[600,146],[500,136],[420,140],[400,140],[385,142],[345,142],[330,140],[235,136],[215,138],[170,140]];
const CARENAGEM = [[160,110],[200,94],[420,88],[520,100],[600,114]];

// interpola a altura de uma linha poligonal num x qualquer
function alturaEm(pts, x) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1);
  }
  return pts[pts.length - 1][1];
}

function palhetas(xs, largura, classe) {
  const int = [...NUCLEO_INT].reverse();
  return xs.map((x, k) => {
    const topo = alturaEm(NUCLEO_EXT, x) + 1.5, base = alturaEm(int, x) - 1.5;
    return `<rect class="${classe} ${k % 2 ? "estator" : ""}" x="${x}" y="${topo}" width="${largura}" height="${base - topo}" rx="1"/>`;
  }).join("");
}

function metade() {
  const hpc = Array.from({ length: 9 }, (_, k) => 240 + k * 10);
  const lpt = Array.from({ length: 4 }, (_, k) => 428 + k * 17);
  return `
    <polygon class="duto-bypass" points="${SUPERIOR([[52,56],[150,40],[470,48],[548,62],...[...CARENAGEM].reverse(),[160,110]])}"/>
    <polygon fill="url(#gradNucleo)" points="${SUPERIOR([...NUCLEO_EXT, ...NUCLEO_INT])}"/>
    <polygon class="carenagem" points="${SUPERIOR([...CARENAGEM, ...[...NUCLEO_EXT].reverse()])}"/>
    ${palhetas([176, 188, 200], 5, "pa pa-fria")}
    ${palhetas(hpc, 4, "pa pa-hpc")}
    <ellipse class="chama" cx="365" cy="131" rx="22" ry="7"/>
    ${palhetas([398], 6, "pa pa-quente")}
    ${palhetas(lpt, 6, "pa pa-quente")}
    <path class="nacele" d="M36,52 C36,28 70,20 140,20 L470,32 C525,36 552,46 562,60 L548,62 C520,52 490,48 470,48 L150,40 C100,40 70,44 52,56 Z"/>
    <path class="fan" d="M120,116 L127,44 L147,44 L141,116 Z"/>
    <path class="fan-brilho" d="M128,110 L133,48 L139,48 L135,110 Z"/>
    <rect class="estator-fan" x="192" y="${alturaEm(CARENAGEM, 192) - 50}" width="5" height="50" rx="2"/>
    <path class="cone" d="M70,150 C78,124 104,113 142,113 L142,150 Z"/>
    <path class="cone-cauda" d="M500,136 C560,138 610,144 650,150 L500,150 Z"/>
    <path class="fluxo fluxo-frio" d="M20,78 L160,74 L470,70 L640,78"/>
    <path class="fluxo fluxo-frio atraso" d="M20,96 L160,88 L420,80 L640,92"/>
    <path class="fluxo fluxo-quente" d="M150,126 L330,134 L400,133 L520,124 L700,132"/>`;
}

export function motorSVG({ marcadores = false, id = "m" } = {}) {
  const marcas = !marcadores ? "" : [
    [1, 137, 30], [2, 285, 98], [3, 365, 108], [4, 455, 92],
  ].map(([n, x, y]) => `
    <g class="marcador" data-passo="${n}" tabindex="0" role="button" aria-label="${tr("Passo", "Step")} ${n}">
      <circle cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y + 4.5}">${n}</text>
    </g>`).join("");
  return `
  <svg class="motor-svg" viewBox="0 0 760 300" role="img"
       aria-label="${tr("Desenho em corte de um motor turbofan: o ar entra pelo fan à esquerda, a maior parte passa por fora do núcleo, e o restante é comprimido, queimado e expandido nas turbinas.",
      "Cutaway drawing of a turbofan engine: air enters through the fan on the left, most of it goes around the core, and the rest is compressed, burned and expanded in the turbines.")}">
    <defs>
      <linearGradient id="gradNucleo-${id}" gradientUnits="userSpaceOnUse" x1="170" x2="660" y1="0" y2="0">
        <stop offset="0" stop-color="#8fbcf2"/><stop offset="0.33" stop-color="#9a86e6"/>
        <stop offset="0.40" stop-color="#ff9a4a"/><stop offset="0.50" stop-color="#ff5c2b"/>
        <stop offset="1" stop-color="#f6b25a"/>
      </linearGradient>
      <linearGradient id="gradJato-${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#ff8a3d" stop-opacity="0.55"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="gradJatoFrio-${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#9cc8ff" stop-opacity="0.35"/><stop offset="1" stop-color="#9cc8ff" stop-opacity="0"/>
      </linearGradient>
      <filter id="brilho-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <path d="M555,58 C620,60 690,66 760,74 L760,226 C690,234 620,240 555,242 Z" fill="url(#gradJatoFrio-${id})"/>
    <path d="M600,118 C650,122 700,128 760,132 L760,168 C700,172 650,178 600,182 Z" fill="url(#gradJato-${id})"/>
    <ellipse cx="365" cy="150" rx="40" ry="30" fill="#ff7a33" opacity="0.35" filter="url(#brilho-${id})"/>
    <g class="metade" style="--grad:url(#gradNucleo-${id})">${metade().replace(/url\(#gradNucleo\)/g, `url(#gradNucleo-${id})`)}</g>
    <g class="metade" transform="matrix(1 0 0 -1 0 300)">${metade().replace(/url\(#gradNucleo\)/g, `url(#gradNucleo-${id})`)}</g>
    <line class="eixo-baixa" x1="142" y1="150" x2="500" y2="150"/>
    <rect class="eixo-alta" x="236" y="145" width="168" height="10" rx="5"/>
    ${marcas}
  </svg>`;
}

// ------------------------------------------------------------ aviãozinho da frota
// Vista de cima de um 737 estilizado; os dois círculos são os motores, coloridos pelo estado.
export function aviaoSVG(idx) {
  return `
  <svg class="aviao" viewBox="0 0 40 40" aria-hidden="false">
    <path class="silhueta" d="M20 2.5c1.3 0 2 1.4 2 3.2V14l15 9.3v3L22 22v9.6l4.6 3.6v2.3L20 36l-6.6 1.5v-2.3l4.6-3.6V22L3 26.3v-3L18 14V5.7c0-1.8.7-3.2 2-3.2z"/>
    <circle class="motor-ponto" data-motor="${2 * idx}" cx="11" cy="21.6" r="3.4" tabindex="0"/>
    <circle class="motor-ponto" data-motor="${2 * idx + 1}" cx="29" cy="21.6" r="3.4" tabindex="0"/>
  </svg>`;
}

// ------------------------------------------------------------ mostrador de EGT (cabine)
// Imitação do instrumento de EGT do cockpit: arco de 240°, de 600 a 1.000 °C.
// O arco colorido vai até a EGT atual; o trecho hachurado até a linha vermelha é a folga.
const GRAU = Math.PI / 180;
function polar(cx, cy, r, ang) { return [cx + r * Math.cos(ang * GRAU), cy + r * Math.sin(ang * GRAU)]; }
function arco(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function mostradorSVG({ egt, limite, cor }) {
  const MIN = 600, MAX = 1000, CX = 160, CY = 148, R = 112;
  const ang = (t) => 150 + 240 * (Math.min(Math.max(t, MIN), MAX) - MIN) / (MAX - MIN);
  const marcas = [];
  for (let t = MIN; t <= MAX; t += 25) {
    const grande = t % 100 === 0;
    const [x0, y0] = polar(CX, CY, R - 14, ang(t)), [x1, y1] = polar(CX, CY, R - (grande ? 26 : 20), ang(t));
    marcas.push(`<line class="m-marca${grande ? " grande" : ""}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`);
    if (grande && t > MIN && t < MAX) {
      const [xt, yt] = polar(CX, CY, R - 40, ang(t));
      marcas.push(`<text class="m-num" x="${xt}" y="${yt + 4}">${t}</text>`);
    }
  }
  const folga = Math.max(limite - egt, 0);
  const [lx0, ly0] = polar(CX, CY, R - 12, ang(limite)), [lx1, ly1] = polar(CX, CY, R + 14, ang(limite));
  const [ltx, lty] = polar(CX, CY, R + 30, ang(limite));
  const [px, py] = polar(CX, CY, R - 30, ang(egt));
  return `
  <svg viewBox="0 0 320 290" class="mostrador" role="img"
       aria-label="${tr(`Mostrador de EGT: ${Math.round(egt)} °C, limite ${limite} °C, folga ${Math.round(folga)} °C`, `EGT gauge: ${Math.round(egt)} °C, limit ${limite} °C, margin ${Math.round(folga)} °C`)}">
    <defs>
      <pattern id="hachura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgba(240,122,69,.18)"/><line x1="0" y1="0" x2="0" y2="6" stroke="#f07a45" stroke-width="2.5"/>
      </pattern>
      <filter id="neon" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter>
    </defs>
    <circle cx="${CX}" cy="${CY}" r="${R + 20}" class="m-aro"/>
    <path d="${arco(CX, CY, R, 150, 390)}" class="m-trilho"/>
    ${folga > 0 ? `<path d="${arco(CX, CY, R, ang(egt), ang(limite))}" stroke="url(#hachura)" class="m-folga"/>` : ""}
    <path d="${arco(CX, CY, R, 150, ang(egt))}" stroke="${cor}" class="m-valor" filter="url(#neon)" opacity=".55"/>
    <path d="${arco(CX, CY, R, 150, ang(egt))}" stroke="${cor}" class="m-valor"/>
    ${marcas.join("")}
    <line x1="${lx0}" y1="${ly0}" x2="${lx1}" y2="${ly1}" class="m-limite"/>
    <text x="${ltx}" y="${lty + 4}" class="m-limite-txt">${limite}</text>
    <line x1="${CX}" y1="${CY}" x2="${px}" y2="${py}" class="m-ponteiro"/>
    <circle cx="${CX}" cy="${CY}" r="9" class="m-cubo"/>
    <text x="${CX}" y="${CY + 56}" class="m-leitura">${Math.round(egt)}<tspan class="m-unid" dx="3">°C</tspan></text>
    <text x="${CX}" y="${CY + 76}" class="m-rotulo">${tr("EGT · decolagem em dia quente", "EGT · takeoff on a hot day")}</text>
  </svg>`;
}

// ------------------------------------------------------------ curva da folga ao longo dos ciclos
// Mostra a vida inteira de uma vez: a folga caindo e um ponto "você está aqui".
export function curvaFolgaSVG({ folgaEm, ciclos, zeraEm, maxCiclos = 20000 }) {
  const X0 = 38, X1 = 310, Y0 = 118, Y1 = 14;
  const topo = Math.ceil(folgaEm(0) / 20) * 20;
  const x = (n) => X0 + (n / maxCiclos) * (X1 - X0);
  const y = (m) => Y0 - ((Math.max(m, -10) + 10) / (topo + 10)) * (Y0 - Y1);
  const pts = [];
  for (let n = 0; n <= maxCiclos; n += 200) pts.push(`${x(n).toFixed(1)},${y(folgaEm(n)).toFixed(1)}`);
  const faixa = (de, ate, cls) => `<rect class="${cls}" x="${X0}" y="${y(ate)}" width="${X1 - X0}" height="${y(de) - y(ate)}"/>`;
  const atual = folgaEm(ciclos);
  const eixoX = [0, 5000, 10000, 15000, 20000].map((n) =>
    `<text class="c-eixo" x="${x(n)}" y="${Y0 + 16}" text-anchor="middle">${n ? tr(`${n / 1000} mil`, `${n / 1000}k`) : "0"}</text>`).join("");
  const eixoY = [0, 30, Math.min(topo, 120)].map((m) =>
    `<text class="c-eixo" x="${X0 - 6}" y="${y(m) + 4}" text-anchor="end">${m}°</text>`).join("");
  return `
  <svg viewBox="0 0 320 140" class="curva" role="img" aria-label="${tr(`Folga caindo ao longo dos ciclos; agora: ${Math.round(atual)} °C`, `Margin dropping over the cycles; now: ${Math.round(atual)} °C`)}">
    ${faixa(30, topo, "c-bom")}${faixa(10, 30, "c-atencao")}${faixa(-10, 10, "c-critico")}
    <line class="c-zero" x1="${X0}" x2="${X1}" y1="${y(0)}" y2="${y(0)}"/>
    ${eixoX}${eixoY}
    <polyline class="c-linha" points="${pts.join(" ")}"/>
    ${zeraEm <= maxCiclos ? `<line class="c-fim" x1="${x(zeraEm)}" x2="${x(zeraEm)}" y1="${Y1}" y2="${Y0}"/>
      <text class="c-fim-txt" x="${x(zeraEm) - 4}" y="${Y1 + 9}" text-anchor="end">${tr("acaba aos", "runs out at")} ${(zeraEm / 1000).toLocaleString(localidade(), { maximumFractionDigits: 1 })}${tr(" mil", "k")}</text>` : ""}
    <line class="c-agora-linha" x1="${x(ciclos)}" x2="${x(ciclos)}" y1="${y(atual)}" y2="${Y0}"/>
    <circle class="c-agora" cx="${x(ciclos)}" cy="${y(atual)}" r="5.5"/>
  </svg>`;
}

// ------------------------------------------------------------ ícones
export const ICONES = {
  termometro: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/></svg>`,
  disco: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`,
  chave: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>`,
};
