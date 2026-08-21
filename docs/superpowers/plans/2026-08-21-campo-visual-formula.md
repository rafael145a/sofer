# Campo visual de fórmula (MathLive) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o `<textarea>` de LaTeX do modal de fórmula por um campo
visual (MathLive), onde a fórmula se monta na tela e o professor nunca vê
código.

**Architecture:** O `<math-field>` do MathLive vira a entrada; o MathJax
continua sendo a saída (SVG do documento, PNG do DOCX) **e** continua
validando invisivelmente cada estado do campo, porque os dois falam dialetos
de LaTeX diferentes. O modelo não muda: já guarda `formula.latex`, e o
MathLive fala LaTeX nos dois sentidos.

**Tech Stack:** React 18, MathLive 0.110, MathJax 3 (`@sofereditor/math`),
Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-21-campo-visual-formula-design.md`

## Global Constraints

- **Notação brasileira é intocável.** `\operatorname{sen}`,
  `\operatorname{tg}`, `\operatorname{cotg}` — nunca `\sin`/`\tan`/`\cot`.
  Prova brasileira imprime "sen".
- **`mathlive` nunca pode ser import estático em `packages/react/src/`.**
  `FormulaDialog` é importado estaticamente por `EditorContext.tsx:5`; um
  `import "mathlive"` no topo põe 812 KB no bundle principal e não emite
  erro nenhum.
- **Nunca usar `getValue('latex-without-placeholders')`.** O MathLive oferece
  esse formato e ele reintroduz em silêncio o bug que este trabalho fecha:
  transforma caixa em branco em `\frac{}{}`, que renderiza vazio. Sempre
  `getValue('latex')`, e gate por `\placeholder{}`.
- **O dado da `PALETA` fica em `{}`.** A tradução para `#?` acontece só na
  chamada de inserção. `#?` é erro de compilação no MathJax
  (`macro parameter character #`), e o `formulaPaleta.render.test.ts` passa
  os 82 itens pelo MathJax de verdade.
- **`\placeholder{}` é erro de compilação no MathJax**
  (`Undefined control sequence`). Fórmula com caixa em branco não entra em
  branco no documento — entra quebrada. O gate do botão Inserir é correção,
  não polimento.
- **Três cópias de CSS** (`apps/playground/src/styles.css` e as duas
  `sofer-editor.css` dos apps) saem na mesma leva. O `diff` entre as duas
  cópias dos apps tem que continuar reduzindo aos 4 hunks de `@font-face`.
- **Bump obrigatório de `packages/react/package.json`**: o manifesto ganha
  dependência. Sem bump, o CI de publish pula o pacote em silêncio e o
  `npm ci` de produção quebra depois.

---

### Task 1: Dependência e carregamento sob demanda

**Files:**
- Modify: `packages/react/package.json`
- Modify: `packages/react/src/FormulaDialog.tsx:49-70`
- Test: `packages/react/src/__tests__/mathliveLazy.test.ts` (criar)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `carregarDeps()` resolvido, com `renderLatexToSvg` do
  `@sofereditor/math` e `MathfieldElement` do `mathlive`, ambos guardados em
  ref. As tarefas 2 e 3 consomem esses dois.

- [ ] **Step 1: Escrever o teste que trava o import dinâmico**

Este teste é a única defesa contra a regressão mais cara e mais silenciosa
deste trabalho. Não existe ESLint neste pacote, então o guarda é este.

```ts
// packages/react/src/__tests__/mathliveLazy.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * O `FormulaDialog` é import ESTÁTICO em `EditorContext.tsx`. Um
 * `import "mathlive"` no topo de qualquer arquivo de `src/` arrasta 812 KB
 * para o bundle principal de todo app que usa o editor — sem erro, sem
 * warning, só mais lento para quem nunca abre uma fórmula.
 *
 * Medido em 21/08/2026: mathlive bundlado = 812 KB minificado / 219 KB gzip.
 */
describe("mathlive só entra por import dinâmico", () => {
  const dir = join(__dirname, "..");
  const arquivos = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));

  it.each(arquivos)("%s", (arquivo) => {
    const src = readFileSync(join(dir, arquivo), "utf8");
    // Casa `import ... from "mathlive"` e `import "mathlive"`.
    // NÃO casa duas formas, e as duas exceções são de propósito:
    //   `import("mathlive")`  → o dinâmico, que é o permitido;
    //   `import type ...`     → apagado na compilação, custo zero em runtime,
    //                           e é assim que se pega o tipo de MathfieldElement
    //                           sem cair no `any`.
    const estatico = /^\s*import\s+(?!type\s)(?:[^;]*?\s+from\s+)?["']mathlive["']/m;
    expect(
      estatico.test(src),
      `${arquivo} importa mathlive em runtime — use import("mathlive") para valor ` +
        `ou "import type" para tipo`,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver passar (ainda não há mathlive nenhum)**

Run: `cd packages/react && npx vitest run src/__tests__/mathliveLazy.test.ts`
Expected: PASS. Confirma que o teste roda; ele ainda não distingue nada.

- [ ] **Step 3: Provar que o teste pega o erro que existe para pegar**

Acrescente temporariamente `import "mathlive";` na primeira linha de
`src/FormulaDialog.tsx`, rode o mesmo comando, confirme **FAIL** com a
mensagem do `${arquivo}`, e desfaça.

Um teste que nunca falhou não é guarda; nesta série já apareceram seis
testes que não asseguravam nada.

- [ ] **Step 4: Acrescentar a dependência e bumpar**

```bash
cd packages/react
npm pkg set dependencies.mathlive="^0.110.0"
npm pkg set version="0.9.0"
cd ../.. && pnpm install
```

- [ ] **Step 5: Carregar os dois módulos na mesma promise**

Em `FormulaDialog.tsx`, o efeito das linhas 49-70 hoje importa só o
`@sofereditor/math`. Ele passa a importar os dois. O ramo de `catch` que já
existe cobre os dois sem mudança — e ele existe por um motivo real: um
deploy que troca o hash dos assets com a prova aberta na aba.

No topo do arquivo, junto dos outros imports — **`import type`, não
`import`**: o TypeScript apaga isso na compilação, então dá tipo de verdade
sem arrastar 812 KB. O teste do Step 1 permite esta forma e só esta.

```tsx
import type { MathfieldElement } from "mathlive";
```

```tsx
  const rendererRef = useRef<((l: string, d: boolean) => FormulaRender) | null>(null);
  // Construtor do <math-field>. Ref e não state: quem re-renderiza é o campo,
  // montado imperativamente na Task 2.
  const mathfieldCtorRef = useRef<typeof MathfieldElement | null>(null);

  useEffect(() => {
    if (!formulaRequest || rendererRef.current) return;
    setCarregando(true);
    setErroCarregando(null);
    // Import DINÂMICO dos dois: mantém mathjax-full E mathlive fora do
    // bundle principal. Ver o teste mathliveLazy.test.ts — trocar por
    // import estático não dá erro nenhum, só fica lento para todo mundo.
    void Promise.all([import("@sofereditor/math"), import("mathlive")])
      .then(([math, mathlive]) => {
        rendererRef.current = math.renderLatexToSvg;
        mathfieldCtorRef.current = mathlive.MathfieldElement;
        setCarregando(false);
      })
      .catch(() => {
        setCarregando(false);
        setErroCarregando(
          "Não foi possível carregar o editor de fórmulas. Recarregue a página e tente de novo.",
        );
      });
  }, [formulaRequest]);
```

- [ ] **Step 6: Rodar a suíte e o typecheck**

Run: `cd packages/react && npx vitest run && npx tsc --noEmit`
Expected: tudo verde. O modal ainda é o de hoje; só o carregamento mudou.

- [ ] **Step 7: Medir o chunk de verdade**

```bash
cd apps/playground && npx vite build
grep -l "MathfieldElement" dist/assets/*.js
ls -l dist/assets/*.js | awk '{printf "%7.0fK %s\n", $5/1024, $9}'
```

Expected: o arquivo que contém `MathfieldElement` **não** é o `index-*.js`
de entrada. Anote os tamanhos no relatório — o chunk sob demanda tinha
992 KB só com mathjax e deve crescer para a ordem de 1,8 MB.

- [ ] **Step 8: Commit**

```bash
git add packages/react apps/playground
git commit -m "feat(react): mathlive carregado sob demanda junto do mathjax"
```

---

### Task 2: O campo substitui o textarea e o preview

**Files:**
- Modify: `packages/react/src/FormulaDialog.tsx`
- Modify: `apps/playground/src/styles.css` (`.ed-formula-input` → `.ed-formula-field`)
- Test: `packages/react/src/__tests__/formulaGuarda.test.ts` (criar)

**Interfaces:**
- Consumes: `rendererRef` e `mathfieldCtorRef` da Task 1.
- Produces: `fieldRef.current` — a instância do `<math-field>`, com
  `.insert(s, opts)` e `.getValue('latex')`. A Task 3 insere por ela.
  Produz também `podeInserir(latex, preview)`, exportada para teste.

- [ ] **Step 1: Escrever o teste do gate**

A função é pura de propósito: o gate é a regra de correção deste trabalho e
precisa de teste que não dependa de DOM.

```ts
// packages/react/src/__tests__/formulaGuarda.test.ts
import { describe, it, expect } from "vitest";
import { podeInserir, motivoBloqueio } from "../formulaGuarda";

describe("gate do botão Inserir", () => {
  it("bloqueia enquanto houver caixa em branco", () => {
    // O MathLive serializa caixa não preenchida como \placeholder{}, e isso
    // é `Undefined control sequence` no MathJax: a fórmula não entraria em
    // branco no documento, entraria QUEBRADA.
    expect(podeInserir("\\frac{1}{\\placeholder{}}", { ok: true })).toBe(false);
    expect(podeInserir("\\placeholder{}", { ok: true })).toBe(false);
  });

  it("bloqueia campo vazio e só de espaço", () => {
    expect(podeInserir("", { ok: true })).toBe(false);
    expect(podeInserir("   ", { ok: true })).toBe(false);
  });

  it("bloqueia quando o MathJax recusou", () => {
    expect(podeInserir("\\frac{1}{2}", { ok: false })).toBe(false);
    expect(podeInserir("\\frac{1}{2}", null)).toBe(false);
  });

  it("libera fórmula completa que renderiza", () => {
    expect(podeInserir("\\frac{1}{2}", { ok: true })).toBe(true);
    expect(podeInserir("\\operatorname{sen} x", { ok: true })).toBe(true);
  });
});

describe("motivo mostrado ao professor", () => {
  it("caixa em branco tem mensagem própria, não o erro cru do MathJax", () => {
    // Sem isto o professor lê "Undefined control sequence \placeholder",
    // que não diz o que fazer.
    expect(motivoBloqueio("\\frac{1}{\\placeholder{}}", { ok: false, error: "Undefined control sequence \\placeholder" }))
      .toBe("Preencha os campos em branco da fórmula.");
  });
  it("erro de LaTeX de verdade passa a mensagem do renderer", () => {
    expect(motivoBloqueio("\\frac", { ok: false, error: "Missing argument for \\frac" }))
      .toBe("Missing argument for \\frac");
  });
  it("fórmula boa não tem motivo", () => {
    expect(motivoBloqueio("x", { ok: true })).toBe(null);
  });
});
```


- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/react && npx vitest run src/__tests__/formulaGuarda.test.ts`
Expected: FAIL — `Failed to resolve import "../formulaGuarda"`.

- [ ] **Step 3: Implementar o gate**

```ts
// packages/react/src/formulaGuarda.ts
/** O que o MathLive serializa numa caixa não preenchida. */
export const PLACEHOLDER = "\\placeholder{}";

type Preview = { ok: boolean; error?: string } | null;

/**
 * O MathLive e o MathJax falam dialetos diferentes de LaTeX. `\placeholder{}`
 * é `Undefined control sequence` do lado do MathJax, então uma fórmula com
 * caixa em branco não chega ao documento em branco: chega quebrada.
 *
 * NÃO trocar por `getValue('latex-without-placeholders')`, que o MathLive
 * oferece: ele apaga a marca e devolve `\frac{}{}`, que renderiza vazio —
 * é exatamente o bug que este gate existe para fechar.
 */
export function podeInserir(latex: string, preview: Preview): boolean {
  if (latex.trim() === "") return false;
  if (latex.includes(PLACEHOLDER)) return false;
  return preview?.ok === true;
}

export function motivoBloqueio(latex: string, preview: Preview): string | null {
  if (latex.includes(PLACEHOLDER)) {
    return "Preencha os campos em branco da fórmula.";
  }
  if (preview && !preview.ok) return preview.error ?? null;
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd packages/react && npx vitest run src/__tests__/formulaGuarda.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Montar o campo imperativamente**

Montagem imperativa, não `<math-field>` em JSX. Três motivos, e o terceiro é
o que decide: o elemento não tem tipo em `IntrinsicElements`; o React 18 põe
atributo e não propriedade em custom element; e o construtor só existe
depois do import dinâmico resolver, então o JSX teria que renderizar
condicionalmente um elemento que ainda não foi definido.

```tsx
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);

  useEffect(() => {
    const Ctor = mathfieldCtorRef.current;
    const host = hostRef.current;
    if (!Ctor || !host || !formulaRequest) return;

    const mf = new Ctor();
    mf.className = "ed-formula-field";
    // Teclado virtual desligado: decisão do usuário. Em desktop rouba altura
    // e duplica a paleta, em inglês e sem sen/tg/cotg.
    mf.mathVirtualKeyboardPolicy = "manual";
    // Atalhos de digitação em português. Sem isto o único atalho rápido é o
    // embutido "sin", que imprime "sin" na prova.
    mf.inlineShortcuts = {
      ...mf.inlineShortcuts,
      sen: "\\operatorname{sen}",
      tg: "\\operatorname{tg}",
      cotg: "\\operatorname{cotg}",
    };
    mf.setValue(formulaRequest.initialLatex);
    // Sem esta linha, editar uma fórmula existente abre com o campo cheio e o
    // botão Inserir DESABILITADO: `latex` continuaria "" e o gate leria campo
    // vazio. Lê de volta do campo em vez de reusar `initialLatex` porque o
    // MathLive pode normalizar na entrada, e o estado tem que ser o que o
    // campo realmente tem.
    setLatex(mf.getValue("latex"));

    const onInput = () => setLatex(mf.getValue("latex"));
    mf.addEventListener("input", onInput);
    host.appendChild(mf);
    fieldRef.current = mf;
    queueMicrotask(() => mf.focus());

    return () => {
      mf.removeEventListener("input", onInput);
      mf.remove();
      fieldRef.current = null;
    };
  }, [formulaRequest, carregando]);
```

E a configuração estática, uma vez por página, no mesmo módulo:

```tsx
// Depois do import dinâmico resolver, na Task 1:
//   mathlive.MathfieldElement.soundsDirectory = null;
// São 240 KB de sons de tecla no pacote. Editor de prova não apita.
// `soundsDirectory` e `fontsDirectory` são ESTÁTICOS na classe, não opções
// por instância. O `fontsDirectory` vem por prop (Step 5b) porque o caminho
// muda por app.
```

- [ ] **Step 5b: A prop do caminho das fontes**

O `fontsDirectory` é **estático na classe** e o caminho **muda por app**
(`/portal2/assets/fonts/mathlive` contra `/assets/fonts/mathlive`), então o
pacote não pode cravá-lo. Ele entra agora, e não na Task 5, porque é API
pública do `@sofereditor/react`: descobrir isso lá seria descobrir uma
mudança de pacote no meio de uma tarefa de app, e mais um bump.

Em `EditorContext.tsx`:

```tsx
export interface EditorProviderProps {
  editor: UseEditorResult;
  children: ReactNode;
  /**
   * De onde servir as 20 fontes .woff2 do MathLive (296 KB). Sem elas o
   * campo desenha com fonte do sistema — feio e SILENCIOSO. O caminho muda
   * por app por causa do base path, então é o app que sabe.
   */
  mathliveFontsDirectory?: string;
}
export function EditorProvider({
  editor,
  children,
  mathliveFontsDirectory,
}: EditorProviderProps): JSX.Element {
  // …
  <FormulaDialog fontsDirectory={mathliveFontsDirectory} />
```

O `FormulaDialog` não recebe prop nenhuma hoje (`FormulaDialog.tsx:15`), então
a assinatura passa a ser:

```tsx
export function FormulaDialog({
  fontsDirectory,
}: {
  fontsDirectory?: string;
}): JSX.Element | null {
```

e no `.then()` do `Promise.all`, antes do `setCarregando(false)`:

```tsx
        if (fontsDirectory) {
          mathlive.MathfieldElement.fontsDirectory = fontsDirectory;
        }
```

- [ ] **Step 6: Trocar o JSX — sai o textarea, sai o SVG do preview**

O `<textarea>` (linhas 149-157) vira o host do campo. O bloco de preview
(linhas 166-199) perde o `dangerouslySetInnerHTML` **e todo o comentário de
segurança que o acompanha** — o campo já mostra a fórmula, e o que sobra ali
é só mensagem de erro.

```tsx
        <div ref={hostRef} className="ed-formula-host" />
        <label className="ed-formula-display">…igual…</label>
        <div className="ed-formula-preview" aria-live="polite">
          {carregando ? (
            <span className="ed-formula-vazio">Carregando o editor…</span>
          ) : erroCarregando ? (
            <span className="ed-formula-erro" role="alert">{erroCarregando}</span>
          ) : motivo ? (
            <span className="ed-formula-erro" role="alert">{motivo}</span>
          ) : null}
        </div>
```

com, antes do `return`:

```tsx
  const motivo = motivoBloqueio(latex, preview);
  const podeSubmeter = podeInserir(latex, preview);
```

e `disabled={!podeSubmeter}` no botão Inserir.

**O render do MathJax continua rodando, invisível.** O efeito das linhas
74-81 fica como está. Ele é o que garante que o LaTeX que vai virar embed
compila no renderer do documento — e essa garantia importa mais agora, não
menos, porque os dois dialetos divergem. O que sai é a exibição do SVG, não
o render.

- [ ] **Step 7: CSS do campo no playground**

Em `apps/playground/src/styles.css`, `.ed-formula-input` (linha 763) vira
`.ed-formula-field` + `.ed-formula-host`. O campo precisa de altura mínima
para não colapsar quando vazio, e de largura total:

```css
.ed-formula-host {
  display: block;
}
.ed-formula-field {
  display: block;
  width: 100%;
  min-height: 56px;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  font-size: 1.1rem;
}
```

- [ ] **Step 8: Rodar tudo**

Run: `cd packages/react && npx vitest run && npx tsc --noEmit`
Expected: verde. Os testes de `applySnippet` ainda passam — ele só morre na
Task 3.

- [ ] **Step 9: Verificação em navegador — os dois desconhecidos do spec**

`pnpm dev` na raiz, abrir http://localhost:5173, inserir uma fórmula.

**(a) Round-trip com edição no meio.** É o risco que o spec marca como não
medido: eu medi `setValue`→`getValue`, não digitação. No console:

```js
const mf = document.querySelector('math-field');
const CASOS = ["\\operatorname{sen}", "\\operatorname{tg}", "\\operatorname{cotg}",
  "\\operatorname{sen} x", "3{,}14", "\\varnothing", "\\emptyset",
  "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "\\begin{cases} x \\\\ y \\end{cases}",
  "\\frac{1}{2}", "\\sqrt[3]{8}", "\\left|x\\right|", "\\vec{F}", "\\mathbb{R}",
  "\\rightleftharpoons", "\\cong", "\\sim", "H_2SO_4", "9{,}8\\,\\text{m/s}^2", "\\lim_{x \\to 0}"];
CASOS.forEach(c => { mf.setValue(c); const o = mf.getValue('latex');
  console.log(o === c ? 'IGUAL' : 'MUDOU', JSON.stringify(c), '->', JSON.stringify(o)); });
```

Expected: 20 `IGUAL`. Depois, **à mão**: digitar `sen` no campo e conferir
que vira `\operatorname{sen}` e não `\sin`; digitar `x` depois dele e
conferir que o `getValue()` continua com `\operatorname{sen}`.

**(b) `insert()` com `#?`.** No jsdom devolveu vazio, que é artefato do
ambiente. Cole no console:

```js
mf.setValue(''); mf.insert('\\frac{#?}{#?}', { focus: true });
console.log(JSON.stringify(mf.getValue('latex')));
```

Expected: `"\\frac{\\placeholder{}}{\\placeholder{}}"` ou equivalente com
placeholders, **e o cursor visivelmente dentro da primeira caixa**. Se vier
vazio ou sem placeholder, PARE: a Task 3 inteira depende disto e o desenho
precisa mudar.

- [ ] **Step 10: Commit**

```bash
git add packages/react apps/playground
git commit -m "feat(react): campo visual substitui o textarea de LaTeX"
```

---

### Task 3: A paleta insere no campo; `applySnippet` morre

**Files:**
- Modify: `packages/react/src/formulaSnippet.ts` (deletar `applySnippet`)
- Modify: `packages/react/src/FormulaDialog.tsx` (`onPaleta`)
- Modify: `packages/react/src/__tests__/formulaSnippet.test.ts`
- Test: `packages/react/src/__tests__/formulaTraducao.test.ts` (criar)

**Interfaces:**
- Consumes: `fieldRef.current.insert()` da Task 2.
- Produces: `paraMathlive(snippet: string): string`.

- [ ] **Step 1: Escrever os testes da tradução**

```ts
// packages/react/src/__tests__/formulaTraducao.test.ts
import { describe, it, expect } from "vitest";
import { paraMathlive } from "../formulaSnippet";
import { PALETA } from "../formulaSnippet";

describe("tradução {} → #?", () => {
  it("converte cada destino de digitação", () => {
    expect(paraMathlive("\\frac{}{}")).toBe("\\frac{#?}{#?}");
    expect(paraMathlive("\\sqrt[{}]{}")).toBe("\\sqrt[#?]{#?}");
    expect(paraMathlive("\\left({}\\right)")).toBe("\\left(#?\\right)");
    expect(paraMathlive("\\{{}\\}")).toBe("\\{#?\\}");
  });

  it("não toca em chave com conteúdo", () => {
    // Estes três são a razão de a tradução ser segura: `pmatrix`, `sen` e
    // `R` estão DENTRO das chaves, então não são o literal `{}`.
    expect(paraMathlive("\\operatorname{sen}")).toBe("\\operatorname{sen}");
    expect(paraMathlive("\\mathbb{R}")).toBe("\\mathbb{R}");
    expect(paraMathlive("\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}"))
      .toBe("\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}");
  });

  it("todo {} de todo item da paleta vira um #?, e nenhum sobra", () => {
    for (const cat of PALETA) {
      for (const item of cat.itens) {
        const antes = (item.snippet.match(/\{\}/g) ?? []).length;
        const depois = paraMathlive(item.snippet);
        expect((depois.match(/#\?/g) ?? []).length, `${cat.nome}/${item.label}`).toBe(antes);
        expect(depois.includes("{}"), `${cat.nome}/${item.label}`).toBe(false);
      }
    }
  });
});

describe("toda estrutura marca onde o professor digita", () => {
  it("todo item de Estruturas tem pelo menos um {}", () => {
    // A Matriz nasceu sem marca nenhuma e o cursor caía depois de
    // \end{pmatrix} — foi o bloqueador da review da paleta.
    const estruturas = PALETA.find((c) => c.nome === "Estruturas")!;
    for (const item of estruturas.itens) {
      expect(item.snippet.includes("{}"), `${item.label} não marca destino`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/react && npx vitest run src/__tests__/formulaTraducao.test.ts`
Expected: FAIL — `paraMathlive` não existe.

- [ ] **Step 3: Implementar e deletar `applySnippet`**

Em `formulaSnippet.ts`, apague `applySnippet` inteira (linhas ~165-190, com
o JSDoc) e ponha:

```ts
/**
 * Traduz o snippet da paleta para o dialeto de inserção do MathLive.
 *
 * O dado fica em `{}` e não em `#?` porque `#` é `macro parameter character`
 * no MathJax: guardar `#?` faria o `formulaPaleta.render.test.ts`, que passa
 * os 82 itens pelo renderer do documento, falhar em toda estrutura.
 *
 * Conferido nos 82 itens (teste abaixo): nenhum tem `{}` que não seja
 * destino de digitação — `\operatorname{sen}`, `\mathbb{R}` e
 * `\begin{pmatrix}` têm conteúdo entre as chaves.
 */
export function paraMathlive(snippet: string): string {
  return snippet.replaceAll("{}", "#?");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd packages/react && npx vitest run src/__tests__/formulaTraducao.test.ts`
Expected: PASS.

- [ ] **Step 5: Tirar os testes de cursor**

Em `__tests__/formulaSnippet.test.ts`, apague os blocos que testam
`applySnippet` (posição de cursor, splice de seleção). A mecânica não é mais
nossa. **Não apague** os testes de conteúdo da `PALETA`: contagem por
categoria, rótulo único por categoria, `titulo` presente e diferente do
`label`. Esses continuam sendo o guarda do dado.

- [ ] **Step 6: Ligar a paleta ao campo**

Em `FormulaDialog.tsx`, `onPaleta` (linhas 94-104) inteira vira:

```tsx
  const onPaleta = (snippet: string) => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.insert(paraMathlive(snippet), { focus: true });
    setLatex(mf.getValue("latex"));
  };
```

e o import da linha 5 troca `applySnippet` por `paraMathlive`.

- [ ] **Step 7: Rodar tudo**

Run: `cd packages/react && npx vitest run && npx tsc --noEmit`
Expected: verde, incluindo `formulaPaleta.render.test.ts` **sem uma linha de
mudança** — é o que a decisão de guardar `{}` compra.

- [ ] **Step 8: Verificação em navegador**

Clicar, no playground, em: Fração, Matriz 2×2, Raiz n-ésima, Sistema,
Módulo, Limite. Para cada um, conferir que **o cursor cai dentro da primeira
caixa** e que o botão Inserir está **desabilitado** com "Preencha os campos
em branco da fórmula.".

Depois preencher a Matriz inteira e conferir que o Inserir libera e a
fórmula entra no documento.

- [ ] **Step 9: Commit**

```bash
git add packages/react
git commit -m "feat(react): paleta insere no campo visual; applySnippet sai"
```

---

### Task 4: Botões desenhados

**Files:**
- Modify: `packages/react/src/FormulaDialog.tsx` (o botão da grade)
- Modify: `apps/playground/src/styles.css`
- Test: `packages/react/src/__tests__/formulaBotao.test.ts` (criar)

**Interfaces:**
- Consumes: o módulo `mathlive` já carregado (Task 1) — o
  `convertLatexToMarkup` sai do mesmo import.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Escrever o teste do nome acessível**

```ts
// packages/react/src/__tests__/formulaBotao.test.ts
import { describe, it, expect } from "vitest";
import { PALETA } from "../formulaSnippet";

/**
 * Com o botão renderizado, o conteúdo vira uma pilha de <span> do KaTeX e o
 * botão fica SEM NOME ACESSÍVEL NENHUM — hoje ao menos o caractere é lido.
 * O aria-label passa a ser a única fonte, então todo item precisa de um.
 */
describe("todo item tem nome acessível", () => {
  it.each(PALETA.flatMap((c) => c.itens.map((i) => ({ cat: c.nome, ...i }))))(
    "$cat / $label",
    ({ titulo, label }) => {
      const nome = titulo ?? label;
      expect(nome.trim().length).toBeGreaterThan(0);
    },
  );
});
```

- [ ] **Step 2: Rodar e ver passar; depois provar que pega**

Run: `npx vitest run src/__tests__/formulaBotao.test.ts` → PASS.
Apague temporariamente o `titulo` **e** o `label` de um item, confirme FAIL,
restaure.

- [ ] **Step 3: Guardar o `convertLatexToMarkup` na Task 1**

No `.then()` do `Promise.all`, acrescente:

Declare a ref junto das outras, no corpo do componente:

```tsx
  const markupRef = useRef<((latex: string) => string) | null>(null);
```

e preencha no `.then()`:

```tsx
        markupRef.current = mathlive.convertLatexToMarkup;
        // 240 KB de sons de tecla no pacote. Editor de prova não apita.
        mathlive.MathfieldElement.soundsDirectory = null;
```

- [ ] **Step 4: Renderizar o botão**

```tsx
            <button
              key={p.label}
              type="button"
              className="ed-formula-paleta-btn"
              title={p.titulo ?? p.label}
              aria-label={p.titulo ?? p.label}
              onClick={() => onPaleta(p.snippet)}
              // Markup vem do `convertLatexToMarkup` do MathLive sobre um
              // snippet ESTÁTICO da nossa PALETA — não é entrada de usuário.
              // Renderiza o snippet SEM tradução: aqui o consumidor é o
              // renderer, não o campo, e `#?` não é LaTeX.
              {...(markup
                ? { dangerouslySetInnerHTML: { __html: markup(p.snippet) } }
                : { children: p.label })}
            />
```

com, antes do `return`:

```tsx
  const markup = markupRef.current;
```

Os dois ramos ficam separados de propósito: passar `dangerouslySetInnerHTML`
**e** `children` na mesma tag é erro em React, e a variante que passa
`undefined` num deles depende de detalhe de implementação para não estourar.

Se o markup ainda não carregou, o botão mostra o `label` — o mesmo de hoje.
`markupRef` é ref e não state, e isso não trava a atualização: quem dispara
o re-render é o `setCarregando(false)` do mesmo `.then()`.

- [ ] **Step 5: Importar o CSS estático**

O `<math-field>` traz o próprio estilo no shadow DOM, mas o markup dos
botões vai para o light DOM e não tem estilo nenhum sem isto. É fácil de
perder porque o campo, que é o que se olha primeiro, funciona sem ele.

Em `apps/playground/src/main.tsx`:

```ts
import "mathlive/static.css";
```

- [ ] **Step 6: Medir a grade nas 7 abas e reajustar**

`pnpm dev`, abrir o modal, e no console:

```js
document.querySelectorAll('.ed-formula-aba').forEach((aba, i) => {
  aba.click();
  const g = document.querySelector('.ed-formula-paleta');
  console.log(i, aba.textContent, g.scrollHeight + 'px', getComputedStyle(g).gridTemplateColumns.split(' ').length + ' col');
});
```

Ajuste `min-height` para o **maior** valor encontrado e as `colunas` do dado
se algum botão estourar a largura. A regra que sustenta o número: **o modal
não pode mudar de altura ao trocar de aba**, senão Cancelar/Inserir pulam sob
o cursor. Anote os 7 valores no relatório.

- [ ] **Step 7: Rodar tudo e commitar**

```bash
cd packages/react && npx vitest run && npx tsc --noEmit
git add packages/react apps/playground
git commit -m "feat(react): botoes da paleta desenhados em vez de escritos"
```

---

### Task 5: Espelhar nos dois apps

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/sofer-editor.css`
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css`
- Modify: o ponto de montagem do editor em cada app (`fontsDirectory` + `static.css`)

**Interfaces:**
- Consumes: os nomes de classe e o `min-height` medidos na Task 4.
- Produces: nada.

**São repositórios separados, em branch própria (`feat/campo-visual-formula`).
Ficam inertes até `@sofereditor/react@0.9.0` existir no npm.**

- [ ] **Step 1: Copiar os hunks de CSS**

As mesmas regras da Task 2 (Step 7) e Task 4 (Step 6), com **hex literal em
vez de `var(--*)`** — é a convenção das cópias dos apps: `#e5e7eb`,
`#6b7280`, `#2563eb`.

- [ ] **Step 2: Conferir que a divergência não cresceu**

```bash
diff portal2-next/src/components/ProvaEditor/sofer-editor.css \
     portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css
```

Expected: **exatamente** os 4 hunks de `@font-face` (`/portal2/assets/fonts/`
contra `/assets/fonts/`) e nada mais. Qualquer quinta diferença é erro.

- [ ] **Step 3: Servir as fontes e apontar o `fontsDirectory`**

20 arquivos `.woff2`, 296 KB, de `node_modules/mathlive/fonts/`. Sem eles o
campo desenha com fonte do sistema e a fórmula fica visivelmente errada —
**em silêncio**, e o caminho difere por app, que é exatamente onde este
projeto já errou com a Liberation Sans.

| App | destino | `fontsDirectory` |
| --- | --- | --- |
| `portal2-next` | `public/assets/fonts/mathlive/` | `"/portal2/assets/fonts/mathlive"` |
| `frequencia-ocorrencia` | `public/assets/fonts/mathlive/` | `"/assets/fonts/mathlive"` |

O `@sofereditor/react` **não** crava o caminho: cada app passa o seu pela
prop `mathliveFontsDirectory` do `EditorProvider`, criada na Task 2 Step 5b.
Aqui é só consumo — nenhuma mudança de pacote nesta tarefa.

- [ ] **Step 4: Importar o `static.css` em cada app**

No mesmo arquivo onde cada app já importa `sofer-editor.css`.

- [ ] **Step 5: Aceite manual nos dois**

O `frequencia-ocorrencia` **não tem gate de tipo nenhum** — TypeScript não
está instalado e `npm run build` é só `vite build`, que não typecheca.
Incompatibilidade de API aparece só em runtime, e o salto de versão arrasta
mais que esta feature. Abrir os dois, montar uma fórmula com fração e
matriz, salvar, reabrir, conferir que volta igual.

- [ ] **Step 6: Commit em cada repositório**

---

## Ordem de release

Fixa, e não é opcional:

1. Merge do monorepo em `main` → o CI publica os 7 pacotes.
2. Conferir `npm view @sofereditor/react@0.9.0` **antes** de mexer nos apps.
3. Bumpar os dois apps + `npm install`.
4. Só então as branches dos apps funcionam.

Os apps consomem do npm, não do workspace. API nova não existe neles até
publicar.
