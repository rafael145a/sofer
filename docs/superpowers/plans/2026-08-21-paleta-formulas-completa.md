# Paleta de fórmulas completa — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paleta do modal de fórmula passa de 8 itens numa grade plana para 76 itens em 7 categorias navegáveis por abas.

**Architecture:** `PALETA` deixa de ser lista plana e vira lista de categorias, cada uma com sua contagem de colunas. O `FormulaDialog` ganha estado de aba ativa e renderiza a grade da categoria selecionada. `applySnippet` não muda. Nenhuma mudança de configuração do MathJax — todos os 76 snippets foram verificados contra o renderer real antes deste plano.

**Tech Stack:** TypeScript, React 18, vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-21-paleta-formulas-completa-design.md`. Ler antes de começar.
- **Branch:** `feat/formulas-matematicas`, já ativa no `editor-monorepo`. Não fazer checkout.
- **Nenhuma mudança na configuração do MathJax.** `packages: ['base','ams']` e o import do `AmsConfiguration` ficam como estão. Os 76 snippets já foram verificados contra essa configuração; **zero falhas**.
- **Notação brasileira, exata:** `\operatorname{sen}`, `\operatorname{tg}`, `\operatorname{cotg}`. **Nunca** `\sin`, `\tan`, `\cot` — renderizam "sin"/"tan"/"cot" e a prova sai errada parecendo certa. `\cos`, `\ln` e `\exp` ficam nativos porque a grafia coincide em português.
- **Nomes das 7 abas, exatos e nessa ordem:** `Estruturas` · `Símbolos` · `Relações` · `Gregas` · `Conjuntos` · `Funções` · `Setas`.
- **Colunas:** `Estruturas` usa 4 (rótulos em palavra); as outras seis usam 6 (rótulos em caractere).
- **A grade tem `min-height` fixo dimensionado para 4 linhas** — o pior caso (Estruturas, 14 itens em 4 colunas). Sem isso o modal muda de altura ao trocar de aba e os botões Cancelar/Inserir pulam sob o cursor.
- **`Estruturas` é a aba padrão** e contém os 8 itens de hoje mais 6. A aba ativa **reseta a cada abertura** do modal.
- **`applySnippet` não muda.**
- **O CSS vive em TRÊS cópias** e as três precisam sair na mesma leva:
  - `apps/playground/src/styles.css` (usa `var(--border)`, `var(--paper)`, `var(--ink)`, `var(--muted)`)
  - `portal2-next/src/components/ProvaEditor/sofer-editor.css` (usa os hex: `#e5e7eb`, `#ffffff`, `#1a1a1f`, `#6b7280`)
  - `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css` (idem)
- **Sem dependência nova.**

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/react/src/formulaSnippet.ts` | os 76 itens agrupados; `applySnippet` intacta |
| `packages/react/src/__tests__/formulaSnippet.test.ts` | trava conteúdo, ordem, notação brasileira e o layout que cabe |
| `packages/react/src/__tests__/formulaPaleta.render.test.ts` | **novo.** roda o renderer real contra os 76 — guardrail permanente |
| `packages/react/src/FormulaDialog.tsx` | aba ativa + render da grade |
| `apps/playground/src/styles.css` | estilos das abas |
| `portal2-next/.../sofer-editor.css` | idem, com hex |
| `frequencia-ocorrencia/.../sofer-editor.css` | idem, com hex |

Caminhos absolutos:

```
MONO=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
P2=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
FREQ=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
```

---

### Task 1: Os 76 itens, agrupados

**Files:**
- Modify: `packages/react/src/formulaSnippet.ts:1-19` (o bloco `PALETA`)
- Modify: `packages/react/src/__tests__/formulaSnippet.test.ts:1-16` (o `describe("PALETA")`)
- Create: `packages/react/src/__tests__/formulaPaleta.render.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `interface CategoriaPaleta { nome: string; colunas: 4 | 6; itens: readonly { label: string; snippet: string }[] }`
  - `PALETA: readonly CategoriaPaleta[]`
  - `applySnippet(text: string, selStart: number, selEnd: number, snippet: string): { text: string; cursor: number }` — **inalterada**

- [ ] **Step 1: Escrever os testes que falham**

Substituir o `describe("PALETA")` existente (topo de `packages/react/src/__tests__/formulaSnippet.test.ts`) por:

```ts
describe("PALETA", () => {
  it("tem as sete categorias, nessa ordem", () => {
    expect(PALETA.map((c) => c.nome)).toEqual([
      "Estruturas",
      "Símbolos",
      "Relações",
      "Gregas",
      "Conjuntos",
      "Funções",
      "Setas",
    ]);
  });

  it("Estruturas vem primeiro e mantém os oito itens originais", () => {
    // Quem já usava a paleta não pode perder velocidade nem reaprender.
    const estruturas = PALETA[0];
    expect(estruturas.nome).toBe("Estruturas");
    const labels = estruturas.itens.map((i) => i.label);
    for (const antigo of [
      "Fração",
      "Expoente",
      "Índice",
      "Raiz",
      "Raiz n-ésima",
      "Somatório",
      "Integral",
      "Matriz 2×2",
    ]) {
      expect(labels, antigo).toContain(antigo);
    }
  });

  it("usa a notação BRASILEIRA das funções trigonométricas", () => {
    // \sin renderiza "sin" e \tan renderiza "tan". Prova brasileira escreve
    // "sen" e "tg". Se alguém "simplificar" para o idioma do LaTeX, a paleta
    // continua parecendo certa e a PROVA IMPRESSA sai errada — por isso o
    // teste trava a string exata, não só que o snippet renderize.
    const funcoes = PALETA.find((c) => c.nome === "Funções")!;
    const porLabel = Object.fromEntries(funcoes.itens.map((i) => [i.label, i.snippet]));
    expect(porLabel["sen"]).toBe("\\operatorname{sen}");
    expect(porLabel["tg"]).toBe("\\operatorname{tg}");
    expect(porLabel["cotg"]).toBe("\\operatorname{cotg}");
    // E o inverso: nenhuma categoria pode conter as formas inglesas.
    const todos = PALETA.flatMap((c) => c.itens.map((i) => i.snippet)).join(" ");
    expect(todos).not.toMatch(/\\sin\b/);
    expect(todos).not.toMatch(/\\tan\b/);
    expect(todos).not.toMatch(/\\cot\b/);
  });

  it("cada categoria cabe em 4 linhas da própria grade", () => {
    // A grade tem min-height fixo para 4 linhas. Uma categoria que passe
    // disso ou rola ou faz o modal pular de altura ao trocar de aba.
    for (const c of PALETA) {
      const linhas = Math.ceil(c.itens.length / c.colunas);
      expect(linhas, `${c.nome} (${c.itens.length} itens / ${c.colunas} col)`).toBeLessThanOrEqual(4);
    }
  });

  it("Estruturas usa 4 colunas e as de símbolo usam 6", () => {
    // Rótulo em palavra ("Raiz n-ésima") não cabe na largura de um símbolo.
    expect(PALETA[0].colunas).toBe(4);
    for (const c of PALETA.slice(1)) {
      expect(c.colunas, c.nome).toBe(6);
    }
  });

  it("não há label repetido dentro da mesma categoria", () => {
    for (const c of PALETA) {
      const labels = c.itens.map((i) => i.label);
      expect(new Set(labels).size, c.nome).toBe(labels.length);
    }
  });

  it("tem 76 itens no total", () => {
    expect(PALETA.reduce((n, c) => n + c.itens.length, 0)).toBe(76);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/formulaSnippet.test.ts
```

Esperado: FAIL — `PALETA.map is not a function` ou `c.nome` indefinido, porque `PALETA` ainda é lista plana.

- [ ] **Step 3: Escrever a paleta**

Substituir o bloco `PALETA` em `packages/react/src/formulaSnippet.ts` (o comentário e o array, linhas 1-19) por:

```ts
export interface CategoriaPaleta {
  /** Rótulo da aba. */
  nome: string;
  /** 4 para rótulos em palavra, 6 para rótulos em caractere. */
  colunas: 4 | 6;
  itens: readonly { label: string; snippet: string }[];
}

/**
 * Paleta do modal de fórmula: 76 itens em 7 categorias, cobrindo do 6º ano ao
 * pré-vestibular, mais física e química de prova.
 *
 * Todos os 76 foram verificados contra o renderer real com
 * `packages: ['base','ams']` + o import por efeito colateral do
 * `AmsConfiguration` — zero falhas. Nenhum exige extensão nova do MathJax.
 * Ao acrescentar um item, rode-o pelo `renderLatexToSvg` antes de commitar.
 *
 * NOTAÇÃO BRASILEIRA: `\sin` renderiza "sin" e `\tan` renderiza "tan". Prova
 * brasileira escreve "sen" e "tg". Por isso as três funções abaixo usam
 * `\operatorname{}`. NÃO troque para as formas nativas do LaTeX: a paleta
 * continuaria parecendo certa e a prova impressa sairia errada.
 */
export const PALETA: readonly CategoriaPaleta[] = [
  {
    nome: "Estruturas",
    colunas: 4,
    itens: [
      { label: "Fração", snippet: "\\frac{}{}" },
      { label: "Expoente", snippet: "^{}" },
      { label: "Índice", snippet: "_{}" },
      { label: "Raiz", snippet: "\\sqrt{}" },
      { label: "Raiz n-ésima", snippet: "\\sqrt[]{}" },
      { label: "Somatório", snippet: "\\sum_{}^{}" },
      { label: "Produtório", snippet: "\\prod_{}^{}" },
      { label: "Integral", snippet: "\\int_{}^{}" },
      { label: "Limite", snippet: "\\lim_{ \\to }" },
      { label: "Derivada", snippet: "\\frac{d}{d}" },
      { label: "Matriz 2×2", snippet: "\\begin{pmatrix} & \\\\ & \\end{pmatrix}" },
      { label: "Sistema", snippet: "\\begin{cases}  \\\\  \\end{cases}" },
      { label: "Parênteses", snippet: "\\left( \\right)" },
      { label: "Binomial", snippet: "\\binom{}{}" },
    ],
  },
  {
    nome: "Símbolos",
    colunas: 6,
    itens: [
      { label: "±", snippet: "\\pm" },
      { label: "×", snippet: "\\times" },
      { label: "÷", snippet: "\\div" },
      { label: "·", snippet: "\\cdot" },
      { label: "∞", snippet: "\\infty" },
      { label: "°", snippet: "^\\circ" },
      { label: "%", snippet: "\\%" },
    ],
  },
  {
    nome: "Relações",
    colunas: 6,
    itens: [
      { label: "≠", snippet: "\\neq" },
      { label: "≈", snippet: "\\approx" },
      { label: "≡", snippet: "\\equiv" },
      { label: "≤", snippet: "\\leq" },
      { label: "≥", snippet: "\\geq" },
      { label: "∝", snippet: "\\propto" },
      { label: "⊥", snippet: "\\perp" },
      { label: "∥", snippet: "\\parallel" },
    ],
  },
  {
    nome: "Gregas",
    colunas: 6,
    itens: [
      { label: "α", snippet: "\\alpha" },
      { label: "β", snippet: "\\beta" },
      { label: "γ", snippet: "\\gamma" },
      { label: "δ", snippet: "\\delta" },
      { label: "ε", snippet: "\\varepsilon" },
      { label: "θ", snippet: "\\theta" },
      { label: "λ", snippet: "\\lambda" },
      { label: "μ", snippet: "\\mu" },
      { label: "π", snippet: "\\pi" },
      { label: "ρ", snippet: "\\rho" },
      { label: "σ", snippet: "\\sigma" },
      { label: "φ", snippet: "\\varphi" },
      { label: "ω", snippet: "\\omega" },
      { label: "Δ", snippet: "\\Delta" },
      { label: "Σ", snippet: "\\Sigma" },
      { label: "Π", snippet: "\\Pi" },
      { label: "Ω", snippet: "\\Omega" },
      { label: "Φ", snippet: "\\Phi" },
    ],
  },
  {
    nome: "Conjuntos",
    colunas: 6,
    itens: [
      { label: "∈", snippet: "\\in" },
      { label: "∉", snippet: "\\notin" },
      { label: "⊂", snippet: "\\subset" },
      { label: "⊆", snippet: "\\subseteq" },
      { label: "∪", snippet: "\\cup" },
      { label: "∩", snippet: "\\cap" },
      { label: "∅", snippet: "\\emptyset" },
      { label: "ℕ", snippet: "\\mathbb{N}" },
      { label: "ℤ", snippet: "\\mathbb{Z}" },
      { label: "ℚ", snippet: "\\mathbb{Q}" },
      { label: "ℝ", snippet: "\\mathbb{R}" },
      { label: "ℂ", snippet: "\\mathbb{C}" },
      { label: "∀", snippet: "\\forall" },
      { label: "∃", snippet: "\\exists" },
    ],
  },
  {
    nome: "Funções",
    colunas: 6,
    itens: [
      { label: "sen", snippet: "\\operatorname{sen}" },
      { label: "cos", snippet: "\\cos" },
      { label: "tg", snippet: "\\operatorname{tg}" },
      { label: "cotg", snippet: "\\operatorname{cotg}" },
      { label: "log", snippet: "\\log_{}" },
      { label: "ln", snippet: "\\ln" },
      { label: "exp", snippet: "\\exp" },
    ],
  },
  {
    nome: "Setas",
    colunas: 6,
    itens: [
      { label: "→", snippet: "\\to" },
      { label: "←", snippet: "\\leftarrow" },
      { label: "⇒", snippet: "\\Rightarrow" },
      { label: "⇔", snippet: "\\Leftrightarrow" },
      { label: "⇌", snippet: "\\rightleftharpoons" },
      { label: "vetor", snippet: "\\overrightarrow{}" },
      { label: "∠", snippet: "\\angle" },
      { label: "△", snippet: "\\triangle" },
    ],
  },
];
```

`applySnippet` e seu comentário ficam **exatamente como estão**, abaixo deste bloco.

- [ ] **Step 4: Rodar para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/formulaSnippet.test.ts
```

Esperado: PASS. Os testes de `applySnippet`, que já existiam no mesmo arquivo, têm que continuar verdes — eles não dependem da forma da `PALETA`.

- [ ] **Step 5: Teste que prova que os 76 renderizam de verdade**

Os testes do Step 1 travam conteúdo e layout, não renderização. Um item com
LaTeX inválido passaria neles e só apareceria como erro no preview, na frente
do professor.

Isto vira um **teste permanente**, não um script descartável: toda inclusão
futura na paleta passa a ser obrigada a renderizar. O `packages/react` depende
de `@sofereditor/math`, então o renderer real está ao alcance daqui. (O
caminho inverso não existiria: `math` não depende de `react`.)

Criar `packages/react/src/__tests__/formulaPaleta.render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderLatexToSvg } from "@sofereditor/math";
import { PALETA } from "../formulaSnippet";

/**
 * A paleta promete que todo item renderiza. Sem este teste, um snippet com
 * LaTeX inválido passa nos testes de conteúdo e só falha na frente do
 * professor, no preview do modal.
 *
 * Roda o renderer de verdade — o mesmo que o modal usa — contra os 76 itens.
 */
describe("todo item da paleta renderiza", () => {
  const todos = PALETA.flatMap((c) => c.itens.map((i) => ({ cat: c.nome, ...i })));

  it("são 76 itens", () => {
    expect(todos).toHaveLength(76);
  });

  it.each(todos)("$cat / $label", ({ snippet }) => {
    const r = renderLatexToSvg(snippet, false);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});
```

Rodar:

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/formulaPaleta.render.test.ts
```

Esperado: 77 testes passando (os 76 mais a contagem).

**Confirme que o teste discrimina** antes de seguir: troque temporariamente um
snippet por algo inválido (`"\\frac{"`), rode, veja o caso daquele item falhar
com a mensagem do MathJax, e reverta. Sem essa checagem não há como saber se o
`it.each` está de fato exercitando os 76 — um `it.each` sobre array vazio passa
sem rodar nada.

- [ ] **Step 6: Typecheck e commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx tsc --noEmit
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/formulaSnippet.ts packages/react/src/__tests__/formulaSnippet.test.ts packages/react/src/__tests__/formulaPaleta.render.test.ts
git commit -m "feat(react): paleta de formula passa a 76 itens em 7 categorias"
```

---

### Task 2: Abas no modal

**Files:**
- Modify: `packages/react/src/FormulaDialog.tsx:5` (import), corpo do componente (estado), `:116-127` (o `<div className="ed-formula-paleta">`)

**Interfaces:**
- Consumes: `PALETA`, `CategoriaPaleta`, `applySnippet` da Task 1.
- Produces: nada para tasks seguintes.

- [ ] **Step 1: Estado da aba ativa**

No topo do componente, junto dos outros `useState` e **antes** do `if (!formulaRequest) return null;`:

```tsx
  const [abaAtiva, setAbaAtiva] = useState(0);
```

E no `useEffect` que já reage a `formulaRequest` (o que faz `setLatex`/`setDisplay` e abre o `<dialog>`), acrescentar o reset junto dos outros:

```tsx
      setAbaAtiva(0);
```

Reabrir o modal sempre começa em Estruturas — é o previsível, e evita o modal
abrir numa aba que o professor não lembra de ter deixado aberta.

- [ ] **Step 2: Trocar o render da paleta**

Substituir o bloco `<div className="ed-formula-paleta"> … </div>` (linhas 116-127) por:

```tsx
        <div className="ed-formula-abas" role="tablist">
          {PALETA.map((cat, i) => (
            <button
              key={cat.nome}
              type="button"
              role="tab"
              aria-selected={i === abaAtiva}
              className="ed-formula-aba"
              onClick={() => setAbaAtiva(i)}
            >
              {cat.nome}
            </button>
          ))}
        </div>
        <div
          className="ed-formula-paleta"
          role="tabpanel"
          style={{ gridTemplateColumns: `repeat(${PALETA[abaAtiva].colunas}, 1fr)` }}
        >
          {PALETA[abaAtiva].itens.map((p) => (
            <button
              key={p.label}
              type="button"
              className="ed-formula-paleta-btn"
              title={p.label}
              onClick={() => onPaleta(p.snippet)}
            >
              {p.label}
            </button>
          ))}
        </div>
```

**O `gridTemplateColumns` vai inline, não no CSS.** O número de colunas é dado
da categoria (4 ou 6) e muda a cada troca de aba; deixá-lo no CSS exigiria uma
classe por contagem e manter isso sincronizado em três arquivos.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx tsc --noEmit && npx vitest run
```

Esperado: limpo, e a suíte inteira do pacote verde.

- [ ] **Step 4: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/FormulaDialog.tsx
git commit -m "feat(react): modal de formula navega a paleta por abas de categoria"
```

---

### Task 3: CSS das abas, nas três cópias

**Files:**
- Modify: `apps/playground/src/styles.css` (junto do bloco `.ed-formula-*`, hoje na linha ~716)
- Modify: `portal2-next/src/components/ProvaEditor/sofer-editor.css` (~linha 610)
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css` (idem)

**Interfaces:**
- Consumes: as classes `ed-formula-abas`, `ed-formula-aba` e `ed-formula-paleta` da Task 2.
- Produces: nada.

- [ ] **Step 1: Playground (com variáveis CSS)**

Em `apps/playground/src/styles.css`, **antes** da regra `.ed-formula-paleta` existente, acrescentar:

```css
.ed-formula-abas {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
}
.ed-formula-aba {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ed-formula-aba:hover {
  background: #eef0f3;
}
.ed-formula-aba[aria-selected="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
```

E **substituir** a regra `.ed-formula-paleta` existente por:

```css
.ed-formula-paleta {
  display: grid;
  /* grid-template-columns vem inline do componente: 4 para Estruturas
     (rótulos em palavra), 6 para as categorias de símbolo. */
  gap: 4px;
  /* Altura do pior caso (Estruturas: 14 itens em 4 colunas = 4 linhas).
     Sem isto o modal muda de altura ao trocar de aba e os botões
     Cancelar/Inserir pulam sob o cursor. */
  min-height: 124px;
  align-content: start;
}
```

- [ ] **Step 2: As duas cópias dos apps (com hex)**

Mesmo bloco, trocando as variáveis pelos hex que essas cópias já usam —
`var(--border)` → `#e5e7eb`, `var(--muted)` → `#6b7280`, `var(--accent)` →
`#2563eb`. Confira os hex abrindo o arquivo: as cópias não têm as variáveis
definidas, e uma cor que caia no default do navegador deixa a aba ativa
ilegível.

```css
.ed-formula-abas {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 6px;
}
.ed-formula-aba {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
}
.ed-formula-aba:hover {
  background: #eef0f3;
}
.ed-formula-aba[aria-selected="true"] {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
```

E a mesma substituição de `.ed-formula-paleta` (o bloco é idêntico ao do
playground — não usa variável nenhuma).

- [ ] **Step 3: Confirmar que as duas cópias dos apps continuam idênticas**

```bash
diff /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/sofer-editor.css \
     /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css \
  && echo IDENTICOS
```

Esperado: `IDENTICOS`. Qualquer diferença aqui é erro de transcrição — os dois
`sofer-editor.css` não têm divergência intencional (diferente dos
`CustomToolbar.tsx`, que divergem numa linha de propósito).

- [ ] **Step 4: Confirmar que as três têm as classes novas**

```bash
for f in /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/apps/playground/src/styles.css \
         /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/sofer-editor.css \
         /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css; do
  printf "%s: abas=%s aba=%s min-height=%s\n" "$(basename $(dirname $f))" \
    "$(grep -c 'ed-formula-abas' $f)" "$(grep -c 'ed-formula-aba{\|ed-formula-aba ' $f)" \
    "$(grep -c 'min-height: 124px' $f)"
done
```

Esperado: cada arquivo com pelo menos 1 em cada coluna.

- [ ] **Step 5: Commits (dois repositórios)**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add apps/playground/src/styles.css
git commit -m "feat(playground): estilos das abas da paleta de formula"

cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
git add src/components/ProvaEditor/sofer-editor.css
git commit -m "feat(prova): estilos das abas da paleta de formula"

cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores
git add frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css
git commit -m "feat(prova): espelha os estilos das abas da paleta de formula"
```

**Atenção:** a raiz do repo git do freq é `portal-professores` (o app está num
subdiretório), e `git status` ali pode mostrar um `.claude/scheduled_tasks.lock`
deletado, alheio a este trabalho — **não** incluir no commit.

---

## Ordem e dependências

```
Task 1 (dados) ─> Task 2 (abas) ─> Task 3 (CSS)
```

Estritamente sequencial: a Task 2 não compila sem o tipo da Task 1, e a Task 3
estiliza classes que a Task 2 cria.

## Verificação no navegador (fica com o coordenador)

O playground local basta — não precisa da stack do app.

1. Abrir `√x`. **Estruturas** vem aberta, com 14 itens em 4 colunas.
2. Clicar em cada uma das 7 abas. **A altura do modal não muda** — os botões
   Cancelar/Inserir ficam parados. É o teste do `min-height`.
3. Em **Funções**, clicar em `sen` → o campo recebe `\operatorname{sen}` e o
   preview mostra **"sen"**, não "sin". É o risco número um do spec.
4. Em **Gregas**, conferir que os 18 cabem em 3 linhas sem rolagem.
5. Clicar em `^{}` (Estruturas) com o campo vazio → o preview acusa erro e o
   botão Inserir fica desabilitado. Confirmar que a mensagem do MathJax é
   compreensível — é o último risco do spec.
6. Fechar e reabrir o modal → volta em **Estruturas**, não na última aba usada.
