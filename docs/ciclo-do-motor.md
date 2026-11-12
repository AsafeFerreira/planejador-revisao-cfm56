# Como funciona o ciclo do CFM56-7B

Texto de estudo deste projeto. Explica a física que o modelo da etapa 2 vai calcular.

## 1. A ideia geral: o ciclo Brayton

Todo motor a jato faz quatro coisas com o ar, nesta ordem:

1. **Comprime** o ar (compressores).
2. **Esquenta** o ar comprimido queimando combustível (câmara de combustão).
3. **Expande** o gás quente em turbinas, que tiram energia dele para girar os compressores.
4. **Acelera** o que sobra para trás, num bocal. Empurrar ar para trás empurra o avião para a
   frente (terceira lei de Newton).

Esse ciclo se chama **ciclo Brayton**. A regra mais importante dele: **quanto maior a razão de
pressão, maior a eficiência térmica**. No ciclo ideal:

    eficiência = 1 − (1 / razão de pressão)^((γ − 1) / γ)      com γ = 1,4 para o ar

Para o CFM56-7B24 (razão de pressão 25,8, dado da ICAO): 1 − 25,8^(−0,286) ≈ **0,60**, ou seja,
60% no caso ideal. O motor real fica abaixo disso, porque compressores e turbinas têm perdas.

## 2. As partes do CFM56-7B (motor de dois eixos)

O ar entra pela esquerda e passa por:

| Parte | O que faz |
|---|---|
| **Fan** | O "ventilador" grande da frente. Acelera muito ar com pouca compressão. |
| **Booster** (LPC) | Compressor de baixa pressão, logo atrás do fan, no mesmo eixo. |
| **HPC** | Compressor de alta pressão. Faz a maior parte da compressão. |
| **Câmara de combustão** | Queima o combustível. Aqui está o ponto mais quente do motor. |
| **HPT** | Turbina de alta pressão. Tira energia do gás para girar o HPC. |
| **LPT** | Turbina de baixa pressão. Tira energia do gás para girar o fan e o booster. |
| **Bocal** | Acelera o gás que sobra para trás. |

São **dois eixos** (dois "spools") girando em velocidades diferentes:

- **Eixo de baixa (N1):** LPT → fan + booster. A rotação N1 é o que o piloto usa para ajustar o
  empuxo.
- **Eixo de alta (N2):** HPT → HPC. Gira bem mais rápido.

## 3. Bypass: por que o motor é tão econômico

A maior parte do ar que o fan empurra **não passa pelo núcleo** (booster, HPC, câmara e
turbinas): ela contorna o núcleo por fora e sai direto para trás. A **razão de bypass** diz
quanto ar contorna para cada parte que passa pelo núcleo. No CFM56-7B ela fica entre **5,0 e
5,5** (dado da ICAO).

Por que isso economiza combustível: é mais eficiente acelerar **muito ar um pouco** do que
**pouco ar muito**. No CFM56-7B, a maior parte do empuxo vem do ar de bypass, empurrado pelo fan.

## 4. EGT e margem de EGT

A **EGT** (Exhaust Gas Temperature) é a temperatura do gás medida por termopares na região das
turbinas. Ela importa porque é a melhor janela que temos para a temperatura da parte mais
quente do motor (a saída da câmara e a HPT), que é quente demais para medir diretamente.

A **margem de EGT** é a folga entre a EGT na decolagem, num dia quente, e o limite de
certificação do motor:

    margem de EGT = limite de EGT − EGT na decolagem (corrigida para dia quente)

Motor novo tem margem grande. Com o desgaste, a margem cai. Quando ela fica perto de zero, o
motor precisa ir para a oficina.

## 5. Por que a EGT sobe quando o motor se desgasta

É a pergunta mais importante do projeto. A cadeia de causa e efeito:

1. Com o uso, as pás do **HPC** sofrem erosão e as folgas nas pontas das pás aumentam. O HPC
   fica **menos eficiente**: precisa de mais trabalho para entregar a mesma compressão.
2. Quem fornece esse trabalho é a **HPT**. Para tirar mais trabalho do gás, ela precisa de gás
   mais quente.
3. O piloto (ou o sistema de controle, o FADEC) pede o mesmo empuxo, ou seja, a mesma rotação
   N1. Para manter esse empuxo com um núcleo menos eficiente, o FADEC **injeta mais
   combustível**.
4. Mais combustível → gás **mais quente** na saída da câmara → gás mais quente também depois das
   turbinas → **EGT mais alta**.
5. EGT mais alta para o mesmo empuxo = **margem de EGT menor**.

O mesmo vale para o desgaste da HPT: uma turbina menos eficiente tira menos trabalho do gás, e
o motor compensa com mais combustível e mais temperatura.

Resumo em uma frase: **o motor desgastado precisa queimar mais combustível para entregar o mesmo
empuxo, e esse combustível a mais aparece como temperatura a mais.**

## 6. Como isso vira o projeto

- **Etapa 2:** um modelo que calcula as temperaturas e pressões em cada parte do motor, ajustado
  até o consumo de combustível bater com o medido pela ICAO.
- **Etapa 3:** reduzir aos poucos a eficiência do HPC e da HPT no modelo (simulando os ciclos de
  voo) e observar a EGT subir e a margem cair.
- **Etapa 4:** usar a curva de margem de EGT, junto com a vida das peças com vida limitada
  (LLPs), para prever quando cada motor de uma frota fictícia vai para a oficina.
