# Fórmulas matemáticas no editor — desenho

## Problema

O editor não tem como escrever matemática. Uma prova de matemática hoje sai com
fração escrita como `1/2` e expoente como `x^2`, ou com a fórmula colada como
print de tela — que borra na impressão e não sobrevive a mudança de tamanho de
página.

`@sofereditor/math` existe no monorepo desde o início, mas é um placeholder:

```ts
// @sofereditor/math — placeholder. Implementation pending.
export const PACKAGE_NAME = "@sofereditor/math";
```

Nada no repositório menciona LaTeX, MathML, KaTeX ou MathJax. É greenfield.

### A restrição que define o tamanho do trabalho

O modelo de embed é mono-tipo:

```ts
export type InsertContent = string | ImageEmbed;
```

`isImageEmbed` é o único narrowing, e aparece em **oito** arquivos de código
em quatro pacotes: `core/commands.ts`, `core/types.ts`, `export-pdf/html.ts`,
`export-docx/docx.ts`, `react/renderInline.tsx`, `react/useEditor.ts`,
`react/htmlToSlice.ts`, `react/resolvePastedImages.ts`. Tudo que hoje trata
"embed" assume "imagem".

### Decisões do usuário

1. **A fórmula não precisa ser editável no Word.** Basta aparecer certa. Isso
   descarta o pipeline LaTeX→MathML→OMML, que é a parte mais cara e mais
   frágil do problema.
2. **Entrada por paleta + campo de LaTeX com preview**, no modelo do Google
   Docs: quem sabe LaTeX digita, quem não sabe clica. A fonte da verdade
   guardada no documento é LaTeX nos dois casos.

### O bloqueio descoberto na exploração

`packages/export-docx/src/docx.ts:591-595`:

```ts
// docx's ImageRun requires a `fallback` for type "svg" (RegularImageOptions);
// svg as unresolved (skip) until we add fallback support.
if (resolved?.type === "svg") resolved = null;
```

**SVG é descartado silenciosamente no export DOCX.** Se a fórmula for SVG, ela
some do Word — exatamente o que a decisão 1 proíbe.

Isso já é um defeito hoje, independente de fórmulas: um SVG colado numa prova
desaparece do DOCX sem aviso. Consertá-lo é pré-requisito, e o conserto vale
por si.

## Desenho

### 1. Modelo: um campo opcional, não um tipo novo

`ImageEmbed` ganha dois campos opcionais:

```ts
  /**
   * Presente ⇒ este embed é uma fórmula. A imagem (`src`) é o RENDER; isto é
   * a fonte. Reabrir o editor de fórmula relê `latex` daqui.
   */
  formula?: {
    /** Fonte da verdade. O que o professor escreveu. */
    latex: string;
    /**
     * Bloco (`\displaystyle`, centrado) em vez de inline. Guardado explícito
     * em vez de derivado de `align === "center"`: derivar acoplaria o modo da
     * fórmula a um campo de layout de imagem que o usuário pode mexer pelo
     * alinhamento da toolbar, e reabrir o modal cairia no modo errado.
     */
    display: boolean;
    /**
     * Alinhamento de base para fórmula inline, no formato que o MathJax
     * devolve (ex.: "-0.464ex"). Aplicado como `vertical-align` no <img> para
     * a fórmula sentar na linha do texto em vez de flutuar no topo.
     * Ausente quando `display` é true.
     */
    vAlign?: string;
  };
  /**
   * PNG data URL. Só o `export-docx` consome: o `ImageRun` de `type: "svg"`
   * exige um `fallback` raster. Presente em qualquer embed cujo `src` seja
   * SVG — não é exclusivo de fórmula.
   */
  svgFallback?: string;
```

`isImageEmbed` fica **intocado**. É o ponto todo do desenho: paginação,
clipboard, overlay de resize, `getSelectedEmbed`, Backspace/Delete de embed,
`export-pdf` e `htmlToSlice` continuam funcionando sem uma linha de mudança. A
fórmula nasce com tudo isso de graça.

Helper novo, em `core/types.ts`, ao lado de `isImageEmbed`:

```ts
export function isFormulaEmbed(v: unknown): v is ImageEmbed & {
  formula: NonNullable<ImageEmbed["formula"]>;
} {
  return isImageEmbed(v) && (v as ImageEmbed).formula != null;
}
```

Só dois lugares precisam distinguir fórmula de imagem: a toolbar (mostrar
"Editar fórmula" em vez de "Legenda") e o duplo clique que reabre o modal.

**Descartado: `FormulaEmbed` como tipo próprio.** Custaria um ramo nos oito
arquivos de narrowing e reabriria paginação, DOCX, PDF e clipboard — muito
risco para ganhar pureza de modelo. O preço da escolha é honesto e fica
registrado: no modelo, uma fórmula **é** uma imagem que carrega seu LaTeX.

### 2. Render: MathJax v3 `tex-svg`, só no caminho de autoria

MathJax gera SVG com os paths dos glifos embutidos. Dois ganhos que importam
especificamente neste projeto:

- **A política Arial-only não conflita.** A fórmula não usa fonte do sistema;
  os glifos são geometria dentro do SVG. Nenhuma fonte nova entra no
  documento, no PDF ou no DOCX.
- **O harness do PDF não precisa de nada novo.** O SVG e o PNG são gerados no
  momento da inserção e **guardados no documento**. O caminho de render e o de
  PDF nunca carregam MathJax. O `<img>` do htmlSnapshot já é auto-contido,
  então a regra "PDF sem fallback" continua valendo por construção.

MathJax carrega sob demanda quando o modal abre (~1,5MB). É caminho de
autoria, não de leitura — a prova aberta para conferência não paga esse custo.

#### Três detalhes de implementação que erram fácil

**`fontCache` tem que ser `'local'` ou `'none'`.** O padrão do MathJax SVG é
`'global'`: os glifos vão para um `<defs>` compartilhado fora do SVG e cada
fórmula vira um monte de `<use>` apontando para lá. Extraído do documento, o
SVG renderiza **em branco**. Com `'local'` os paths ficam dentro do próprio
SVG, que é o que precisamos para ele viajar como data URL.

**As dimensões vêm em `ex`, o embed precisa de px.** O MathJax devolve
`width`/`height` em unidades `ex`, relativas ao tamanho de fonte. Converter na
mão erra. O caminho certo: renderizar num `<div>` fora da tela com o
`font-size` do documento aplicado e ler `getBoundingClientRect()`. Os px
medidos viram `embed.width`/`embed.height`.

**O PNG de fallback sai de canvas.** Carregar o SVG data URL num `Image`,
desenhar num `<canvas>` a **3×** e chamar `toDataURL('image/png')`. O 3× é
para a fórmula não borrar na impressão. Canvas não fica tainted porque o SVG é
auto-contido — não referencia nada externo. Se referenciasse, `toDataURL`
lançaria `SecurityError`, e é por isso que `fontCache: 'local'` também importa
aqui.

### 3. Entrada: `requestFormula`, a quarta instância de um padrão existente

`requestLink`, `requestImageCaption` e `requestPageConfig` já usam o mesmo par
request/resolve, com captura e restauração da seleção do modelo — o mecanismo
que existe porque o modal refoca o editor ao fechar e colapsaria a seleção
(bug #6). A fórmula segue o mesmo par, não inventa padrão:

```ts
requestFormula: (initial?: { latex: string; display: boolean })
  => Promise<{ latex: string; display: boolean } | null>;
resolveFormulaRequest: (result: { latex: string; display: boolean } | null) => void;
```

O modal (`FormulaDialog.tsx`, ao lado de `ImageCaptionDialog.tsx`) tem três
partes: paleta de botões, campo de LaTeX, preview ao vivo.

Paleta mínima — o que uma prova de escola usa de fato:

| Botão | Insere |
| --- | --- |
| Fração | `\frac{}{}` |
| Expoente | `^{}` |
| Índice | `_{}` |
| Raiz | `\sqrt{}` |
| Raiz n-ésima | `\sqrt[]{}` |
| Somatório | `\sum_{}^{}` |
| Integral | `\int_{}^{}` |
| Matriz 2×2 | `\begin{pmatrix} & \\ & \end{pmatrix}` |

O botão insere na posição do cursor e põe o cursor no primeiro `{}` vazio.

O preview re-renderiza com debounce. LaTeX inválido mostra a mensagem de erro
do MathJax no lugar do preview e **desabilita o botão de inserir** — nunca
inserir um embed cujo render falhou.

### 4. DOCX: implementar o `fallback` que falta

Trocar o `resolved = null` de `docx.ts:595` por um `ImageRun` de `type: "svg"`
com `fallback` apontando para o PNG:

```ts
new ImageRun({
  type: "svg",
  data: svgBytes,
  fallback: { type: "png", data: pngBytes },
  transformation: { width, height },
})
```

Word 2016+ mostra o SVG vetorial; versões antigas caem no PNG. Conserta o
defeito existente de SVG sumindo do DOCX, além de habilitar a fórmula.

Quando o embed é SVG e **não** tem `svgFallback` (documento antigo, SVG colado
antes desta mudança), o comportamento atual se mantém: pula a imagem e conta
em `skipped`. Não inventar um raster no servidor.

### 5. Editar depois

Duplo clique numa fórmula reabre o modal com o LaTeX guardado. O handler entra
junto do `pointerdown` que já seleciona embed em `Editor.tsx:384-408`, e usa
`isFormulaEmbed` para não disparar em imagem comum.

Na toolbar, quando o embed selecionado é fórmula, o botão "Legenda" dá lugar a
"Editar fórmula". Fórmula não recebe legenda — quem quiser texto embaixo
escreve um parágrafo.

### 6. Inline e bloco

Inline é o padrão, com o `vAlign` do MathJax aplicado como `vertical-align` no
`<img>`. Sem isso a fórmula flutua no topo da linha em vez de sentar na base,
que é o defeito visual clássico de matemática inline.

Bloco é uma opção no modal: renderiza com `\displaystyle` (limites acima e
abaixo do somatório em vez de ao lado) e o embed sai com `align: "center"`,
que `ImageEmbed` já suporta e que já funciona em paginação, PDF e DOCX.

## Onde mexe

| Arquivo | O quê |
| --- | --- |
| `packages/core/src/types.ts` | campos `formula` e `svgFallback` em `ImageEmbed`; helper `isFormulaEmbed` |
| `packages/math/src/index.ts` | render LaTeX→SVG, medição em px, geração do PNG 3×. É o único lugar que conhece MathJax |
| `packages/math/package.json` | sai de `private: true`; entra `mathjax-full` |
| `packages/react/src/FormulaDialog.tsx` | **novo.** Paleta, campo, preview |
| `packages/react/src/useEditor.ts` | `requestFormula` / `resolveFormulaRequest` |
| `packages/react/src/Editor.tsx` | duplo clique reabre o modal |
| `packages/react/src/Toolbar.tsx` | botão de inserir fórmula; "Editar fórmula" no lugar de "Legenda" |
| `packages/react/src/renderInline.tsx` | aplicar `vertical-align` quando `formula.vAlign` existe |
| `packages/export-pdf/src/html.ts` | o mesmo `vertical-align` em `imgStyles` — senão `parity.test.tsx` quebra |
| `packages/export-docx/src/docx.ts` | `ImageRun` de SVG com `fallback` |
| `apps/playground/src/styles.css` | estilos do modal |

**`export-pdf` muda, ao contrário do que parece.** `html.ts` não serializa o
DOM do editor: ele gera HTML **a partir do modelo**, montando um array
`imgStyles` próprio (`html.ts:399-406`). Se o `vertical-align` da fórmula
inline entrar só no `renderInline.tsx` e não aqui, o editor e o PDF divergem —
e existe um teste que trava exatamente isso, `packages/react/src/__tests__/parity.test.tsx`,
que compara os dois caminhos. Ele vai falhar, e com razão: é o guardrail do
norte do projeto (fidelidade editor↔exportações).

Acrescente `packages/export-pdf/src/html.ts` à tabela: `vertical-align` em
`imgStyles` quando `embed.formula?.vAlign` existir.

Os consumidores (`portal2-next`, `frequencia-ocorrencia`) precisam montar o
`FormulaDialog` e um botão na `CustomToolbar`, espelhado entre os dois — mesma
mecânica das outras três modais que eles já montam.

## Fora de escopo

- **OMML / equação editável no Word.** Decisão explícita do usuário. Se mudar,
  o LaTeX guardado é o ponto de partida — nada precisa ser re-digitado.
- **Importar fórmula de DOCX.** `import-docx` vai continuar ignorando `m:oMath`.
  Uma prova antiga com equação do Word entra sem ela, como hoje.
- **Numeração de equações** (`(1)`, `(2)` à direita).
- **Migrar imagens base64 para Blob.** Fórmulas são pequenas (SVG de poucos KB
  + PNG de dezenas). Não muda a conta que adia essa migração.

## Riscos

- **`fontCache: 'local'` é o risco número um.** Errar dá SVG que renderiza no
  preview (onde o `<defs>` global existe na página) e sai **em branco** no
  documento salvo, no PDF e no DOCX. Teste obrigatório: extrair o data URL
  gerado, abrir isolado, confirmar que os glifos aparecem.
- **Medição em px depende do `font-size` do documento.** Renderizar fora da
  tela sem herdar o `font-size` certo dá fórmula com tamanho errado em relação
  ao texto ao redor. O nó de medição tem que estar sob a mesma cascata do
  `.ed-root`, não solto no `<body>`.
- **1,5MB de MathJax.** Aceitável só porque é carregado sob demanda. Se acabar
  entrando no bundle principal por um import estático descuidado, o custo cai
  em cima de todo mundo que abre uma prova para ler. Verificar no build.
- **`export-docx` roda no servidor** (`@editor/export-pdf-server` e o job de
  DOCX). O `ImageRun` de SVG com fallback precisa funcionar em Node, não só no
  browser. O PNG já vem pronto no documento, então não há canvas envolvido no
  servidor — mas confirmar.
- **Fórmula muito larga estoura a margem.** Uma matriz grande passa da largura
  útil da página, e `ImageEmbed` não tem clamp de largura máxima. **Padrão:
  não inventar comportamento novo** — a fórmula se comporta como qualquer
  imagem larga se comporta hoje. Antes de implementar, medir o que é esse
  "hoje" (`packages/react/src/imageConstraints.ts` existe e pode já resolver);
  se a imagem larga já for clampada, a fórmula herda o clamp de graça e este
  risco fecha sem código.
