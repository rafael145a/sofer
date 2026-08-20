# Bordas da tabela atrás de um ícone — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o `<select>` de bordas solto por um botão-ícone que abre um painel com os cinco presets e a cor da linha, nas três superfícies onde ele existe — e impedir que a barra flutuante da tabela cubra a da imagem.

**Architecture:** Um componente puro `TableBorderPanel` novo em `packages/react` carrega o conteúdo e é testado por render estática. Os dois consumidores têm sua própria versão em HeroUI/Tailwind (não dá para reusar o componente do pacote: estilo e biblioteca de botões são outros), verificada no navegador. O conflito das barras flutuantes se resolve com um early-return.

**Tech Stack:** React 18, TypeScript, vitest + `react-dom/server` (monorepo); HeroUI 2.7, TailwindCSS, `react-icons/tb` (consumidores).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-20-toolbar-flutuante-tabela-design.md`. Ler antes de começar.
- **Ícone de bordas:** `TbBorderAll` nos consumidores; glifo `⊞` (U+229E) no `Toolbar.tsx`. Quadrado dividido em quatro. **Nunca** `▦`, `TbTable`, `TbGrid3x3` ou `TbLayoutGrid` — são grades finas de 9 células, desenho errado.
- **Gatilho sem texto e sem caret.** Só o ícone. `title` e `aria-label` = `"Bordas da tabela"`.
- **Nada dentro do painel de bordas fecha nada** — nem preset, nem cor, nem "Padrão". Hoje o "Restaurar cor da borda" chama `setOpen(false)`; isso sai.
- **Rótulos dos presets, exatos:** `Todas` / `Só externas` / `Só horizontais` / `Só verticais` / `Nenhuma`. Chaves: `all` / `outer` / `horizontal` / `vertical` / `none`.
- **Rótulo da cor:** `Cor da linha`. Botão de restaurar: `Padrão`. `aria-label` do input: `Cor da linha da borda`.
- **Os dois `TableFloatingToolbar.tsx` são byte a byte idênticos** e os dois `CustomToolbar.tsx` diferem só na linha 734 (`as any` num cast de `level`). Não encostar nessa linha.
- **Sem dependência nova.** `react-icons` 5.5.0 e `@heroui/react` (2.7.2 / 2.7.6) já estão nos dois consumidores; `TbBorder{All,Outer,Horizontal,Vertical,None}` e `TbBucketDroplet` conferidos presentes.
- **Nenhuma API de `@sofereditor/*` muda.**

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `editor-monorepo/packages/react/src/TableBorderPanel.tsx` | **novo.** Componente puro: 5 presets + cor da linha. Sem contexto, sem estado. |
| `editor-monorepo/packages/react/src/__tests__/tableBorderPanel.test.tsx` | **novo.** Render estática: destaque segue o modelo, os 5 presets existem. |
| `editor-monorepo/packages/react/src/Toolbar.tsx` | `TableMenu` ganha o gatilho `⊞` + disclosure inline. |
| `editor-monorepo/apps/playground/src/styles.css` | classes do painel, escopadas em `.ed-table-actions`. |
| `portal2-next/src/components/ProvaEditor/TableFloatingToolbar.tsx` | guard do embed; gatilho + painel ancorado; balde no fundo da célula. |
| `portal2-next/src/components/ProvaEditor/CustomToolbar.tsx` | `TableMenu` ganha o gatilho + disclosure inline. |
| `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/{TableFloatingToolbar,CustomToolbar}.tsx` | cópia exata dos dois acima. |

Caminhos absolutos usados nos comandos:

```
MONO=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
P2=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
FREQ=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
```

---

### Task 1: Componente puro `TableBorderPanel` (monorepo)

**Files:**
- Create: `editor-monorepo/packages/react/src/TableBorderPanel.tsx`
- Test: `editor-monorepo/packages/react/src/__tests__/tableBorderPanel.test.tsx`

**Interfaces:**
- Consumes: `TableBorderPreset` de `@sofereditor/core`.
- Produces:
  - `BORDER_PRESETS: readonly { key: TableBorderPreset; label: string; glyph: string }[]`
  - `BORDER_MENU_GLYPH: string` (o `⊞` do gatilho)
  - `TableBorderPanel(props: TableBorderPanelProps): JSX.Element`
  - `interface TableBorderPanelProps { preset: TableBorderPreset; color: string; onPreset: (p: TableBorderPreset) => void; onColor: (c: string) => void; onResetColor: () => void }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `editor-monorepo/packages/react/src/__tests__/tableBorderPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { TableBorderPanel, BORDER_PRESETS, BORDER_MENU_GLYPH } from "../TableBorderPanel";
import type { TableBorderPreset } from "@sofereditor/core";

const html = (preset: TableBorderPreset, color = "#000000"): string =>
  renderToStaticMarkup(
    createElement(TableBorderPanel, {
      preset,
      color,
      onPreset: () => {},
      onColor: () => {},
      onResetColor: () => {},
    }),
  );

/** O trecho do <button> que está marcado como ativo. */
const botaoAtivo = (out: string): string =>
  out.split("<button").find((seg) => seg.includes('aria-pressed="true"')) ?? "";

describe("TableBorderPanel", () => {
  it("oferece os cinco presets do w:tblBorders, nessa ordem", () => {
    expect(BORDER_PRESETS.map((p) => p.key)).toEqual([
      "all",
      "outer",
      "horizontal",
      "vertical",
      "none",
    ]);
  });

  it("usa o quadrado dividido em quatro no gatilho, não a grade fina", () => {
    // ▦ é grade fina e já é o glifo do botão de TABELA. O de bordas é ⊞.
    expect(BORDER_MENU_GLYPH).toBe("⊞");
    expect(BORDER_MENU_GLYPH).not.toBe("▦");
  });

  it("marca exatamente um preset como ativo", () => {
    for (const p of BORDER_PRESETS) {
      const out = html(p.key);
      expect((out.match(/aria-pressed="true"/g) ?? []).length, p.key).toBe(1);
    }
  });

  it("o destaque segue o preset do modelo, não o primeiro da lista", () => {
    // Regressão do risco do spec: sair do <select> com defaultValue para
    // botões controlados só vale se o destaque acompanhar o modelo.
    expect(botaoAtivo(html("outer"))).toContain("Só externas");
    expect(botaoAtivo(html("none"))).toContain("Nenhuma");
    expect(botaoAtivo(html("all"))).toContain("Todas");
  });

  it("mostra a cor da linha recebida no input e na amostra", () => {
    const out = html("all", "#ff0000");
    expect(out).toContain('value="#ff0000"');
    expect(out).toContain("background:#ff0000");
  });

  it("traz o botão de restaurar a cor padrão", () => {
    expect(html("all")).toContain("Padrão");
  });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/tableBorderPanel.test.tsx
```

Esperado: FAIL — `Failed to resolve import "../TableBorderPanel"`.

- [ ] **Step 3: Escrever o componente**

Criar `editor-monorepo/packages/react/src/TableBorderPanel.tsx`:

```tsx
import type { JSX, MouseEvent } from "react";
import type { TableBorderPreset } from "@sofereditor/core";

/**
 * Vocabulário do `w:tblBorders` do Word. Glifos de texto em vez de biblioteca
 * de ícones para manter o idioma do `Toolbar.tsx` (⇤ ≡ ⇥ ☰ • 🔗 ▦ 🖼 ⚙) e não
 * pendurar uma dependência de ícones num pacote publicado.
 *
 * `⊞` (U+229E) é o quadrado dividido em quatro — o ícone de bordas do Word e do
 * Docs. NÃO trocar por `▦`: é grade fina, e já é o glifo do botão de tabela.
 */
export const BORDER_PRESETS: readonly {
  key: TableBorderPreset;
  label: string;
  glyph: string;
}[] = [
  { key: "all", label: "Todas", glyph: "⊞" },
  { key: "outer", label: "Só externas", glyph: "□" },
  { key: "horizontal", label: "Só horizontais", glyph: "▤" },
  { key: "vertical", label: "Só verticais", glyph: "▥" },
  { key: "none", label: "Nenhuma", glyph: "⬚" },
];

/** Glifo do gatilho. Mesmo desenho do preset "all", como no Word. */
export const BORDER_MENU_GLYPH = "⊞";

export interface TableBorderPanelProps {
  preset: TableBorderPreset;
  /** Cor atual da linha, já resolvida (nunca `null`). */
  color: string;
  onPreset: (p: TableBorderPreset) => void;
  onColor: (c: string) => void;
  onResetColor: () => void;
}

/**
 * Conteúdo do painel de bordas: os cinco presets e a cor da linha.
 *
 * Puro de propósito — sem contexto do editor e sem estado. Quem hospeda decide
 * onde ele aparece e de onde vêm os valores; assim dá para testá-lo por render
 * estática, que é a única forma de teste disponível neste pacote.
 */
export function TableBorderPanel({
  preset,
  color,
  onPreset,
  onColor,
  onResetColor,
}: TableBorderPanelProps): JSX.Element {
  return (
    <div className="ed-border-panel">
      <div className="ed-border-presets">
        {BORDER_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="ed-border-preset"
            aria-pressed={preset === p.key}
            title={p.label}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              onPreset(p.key);
            }}
          >
            <span className="ed-border-glyph" aria-hidden>
              {p.glyph}
            </span>
            {p.label}
          </button>
        ))}
      </div>
      <hr />
      <label className="ed-toolbar-label ed-border-color">
        <span className="ed-toolbar-swatch" aria-hidden style={{ background: color }} />
        Cor da linha
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          aria-label="Cor da linha da borda"
        />
      </label>
      <button
        type="button"
        className="ed-border-reset"
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          onResetColor();
        }}
      >
        Padrão
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/tableBorderPanel.test.tsx
```

Esperado: PASS, 6 testes.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx tsc --noEmit
```

Esperado: sem saída.

- [ ] **Step 6: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/TableBorderPanel.tsx packages/react/src/__tests__/tableBorderPanel.test.tsx
git commit -m "feat(react): painel puro de bordas da tabela com os cinco presets"
```

---

### Task 2: Gatilho `⊞` e disclosure inline no `Toolbar.tsx` (monorepo)

**Files:**
- Modify: `editor-monorepo/packages/react/src/Toolbar.tsx:20` (import de tipo), `:732-768` (bloco de bordas), e o corpo de `TableMenu` (`:601-643`)
- Modify: `editor-monorepo/apps/playground/src/styles.css` (depois da regra `.ed-table-actions .ed-table-delete:hover`, hoje na linha ~545)

**Interfaces:**
- Consumes: `TableBorderPanel`, `BORDER_MENU_GLYPH` da Task 1.
- Produces: nada novo para outras tasks.

**Sobre `Esc` e clique fora:** o painel inline **não** registra listener próprio.
Ele vive dentro do menu ▦, que já fecha no clique fora, e fechar o menu recolhe
o painel (Step 2). Só o painel da barra flutuante precisa dos listeners, porque
lá não há menu hospedeiro para fazer isso — é a Task 4 que os coloca.

- [ ] **Step 1: Importar o painel e tirar o tipo que fica sem uso**

Em `Toolbar.tsx`, na lista de imports de tipo (linha ~13-21), **remover** `TableBorderPreset` — ele só era usado no cast do `<select>` que vai sumir. Adicionar, logo abaixo do import de `@sofereditor/core`:

```tsx
import { TableBorderPanel, BORDER_MENU_GLYPH } from "./TableBorderPanel";
```

- [ ] **Step 2: Estado do disclosure em `TableMenu`**

Dentro de `function TableMenu()`, junto do `const [open, setOpen] = useState(false);`:

```tsx
  const [bordersOpen, setBordersOpen] = useState(false);
```

E logo depois do `useEffect` que fecha o menu no clique fora, adicionar:

```tsx
  // Fechar o menu ▦ recolhe o painel: reabrir sempre começa do estado neutro.
  useEffect(() => {
    if (!open) setBordersOpen(false);
  }, [open]);
```

- [ ] **Step 3: Trocar o bloco de bordas**

Substituir tudo entre o `<hr />` da linha 732 e o `</button>` do "Restaurar cor padrão" (linha 768) por:

```tsx
              <hr />
              <button
                type="button"
                className="ed-border-toggle"
                aria-pressed={bordersOpen}
                aria-expanded={bordersOpen}
                title="Bordas da tabela"
                aria-label="Bordas da tabela"
                onClick={(e) => {
                  e.preventDefault();
                  setBordersOpen((v) => !v);
                }}
              >
                {BORDER_MENU_GLYPH}
              </button>
              {bordersOpen && (
                <TableBorderPanel
                  preset={editor.getTableBorderPreset()}
                  color={editor.getTableBorderColor() ?? TABLE_BORDER_COLOR}
                  onPreset={(p) => editor.setTableBorderPreset(p)}
                  onColor={(c) => editor.setTableBorderColor(c)}
                  onResetColor={() => editor.setTableBorderColor(null)}
                />
              )}
```

Nenhum desses `onClick` chama `setOpen(false)` — o painel e o menu ▦ ficam abertos, por decisão do spec.

- [ ] **Step 4: CSS do painel**

Em `apps/playground/src/styles.css`, depois da regra `.ed-table-actions .ed-table-delete:hover { ... }`, acrescentar:

```css
/* Painel de bordas — disclosure dentro do menu ▦.
   Tudo escopado em .ed-table-actions porque a regra genérica
   `.ed-table-actions button` (especificidade 0,1,1) ganharia de classes
   soltas e deixaria os presets como linhas full-width. */
.ed-table-actions .ed-border-toggle {
  width: max-content;
  font-size: 16px;
  line-height: 1;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink);
}
.ed-table-actions .ed-border-toggle:hover {
  background: #eef0f3;
}
.ed-table-actions .ed-border-toggle[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.ed-table-actions .ed-border-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fafbfc;
}
.ed-table-actions .ed-border-presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}
.ed-table-actions .ed-border-preset {
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--ink);
}
.ed-table-actions .ed-border-preset:hover {
  background: #eef0f3;
}
.ed-table-actions .ed-border-preset[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.ed-table-actions .ed-border-glyph {
  font-size: 14px;
  line-height: 1;
}
.ed-table-actions .ed-border-panel hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 0 6px;
}
.ed-table-actions .ed-border-color {
  padding: 2px 6px;
  font-size: 12px;
}
.ed-table-actions .ed-border-reset {
  width: max-content;
  text-align: left;
  background: transparent;
  border: none;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: var(--ink);
}
.ed-table-actions .ed-border-reset:hover {
  background: #eef0f3;
}
```

- [ ] **Step 5: Testes e typecheck do pacote**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run && npx tsc --noEmit
```

Esperado: todos passam, `tsc` sem saída.

- [ ] **Step 6: Verificar no clique de verdade, no playground**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
pnpm dev
```

Abrir `http://localhost:5173`, e **clicando de verdade** (não disparar `change` por script — isso pula justamente o caminho que quebra):

1. Inserir uma tabela 2×3 pelo botão ▦.
2. Clicar numa célula, reabrir o ▦ → aparece o botão `⊞` no lugar das três linhas antigas.
3. Clicar no `⊞` → o painel expande abaixo dele, com os cinco presets.
4. Clicar em "Só externas" → **conferir as duas coisas juntas**: o painel continua aberto E o destaque pulou de "Todas" para "Só externas". Se o destaque não mover, o botão está mentindo o estado — pare e investigue antes de seguir.
5. Clicar em "Nenhuma" → as bordas da tabela somem, painel segue aberto.
6. Mexer na cor da linha → a cor das bordas acompanha, painel segue aberto.
7. Clicar em "Padrão" → volta à cor padrão, painel segue aberto.
8. Clicar fora do menu ▦ → o menu fecha. Reabrir → o painel está recolhido.

- [ ] **Step 7: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/Toolbar.tsx apps/playground/src/styles.css
git commit -m "feat(react): bordas da tabela saem do select e passam a abrir do icone"
```

---

### Task 3: Barra da tabela some com imagem selecionada (portal2-next)

Corrige o defeito 2 do spec, isolado do resto para poder ser revisado e revertido sozinho.

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/TableFloatingToolbar.tsx:302`

**Interfaces:**
- Consumes: `editor.getSelectedEmbed()`, que já existe em `useEditor.ts`.
- Produces: nada.

- [ ] **Step 1: Acrescentar o guard**

Em `TableFloatingToolbar.tsx`, logo depois do `if (disabled) return null;` (linha 302):

```tsx
  // Imagem selecionada dentro da célula: esta barra e a ImageFloatingToolbar
  // ancoram no mesmo y (a imagem fica logo abaixo do topo da tabela), têm o
  // mesmo zIndex 20, e esta é montada DEPOIS (index.tsx:1225 vs :1213) — então
  // o empate de z-index cai pela ordem do DOM e ela cobre a da imagem inteira.
  // Word e Docs fazem igual: selecionou a figura, mandam as ferramentas de
  // figura. As ações de tabela seguem todas no menu ▦ da CustomToolbar, e
  // clicar no texto da célula traz esta barra de volta na hora.
  if (editor.getSelectedEmbed()) return null;
```

Vem depois de `useEditorContext()` e do `useRef`, e não há hook nenhum abaixo — a ordem dos hooks não muda.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
./node_modules/.bin/tsc --noEmit
```

Esperado: sem erro novo em `TableFloatingToolbar.tsx`.

- [ ] **Step 3: Verificar no navegador**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
npm run dev
```

Abrir uma prova, e:

1. Inserir uma tabela e uma imagem numa célula da **primeira linha**.
2. Clicar na imagem → aparece **só** a barra da imagem, com os botões de layout, alinhamento, Legenda e excluir. Nenhuma barra de tabela por cima.
3. Clicar no texto da célula (fora da imagem) → a barra da tabela volta na hora.
4. Clicar numa célula de tabela **sem** imagem nenhuma → a barra da tabela aparece normalmente. (Confirma que o guard não some com a barra em situação legítima.)
5. Selecionar uma imagem **fora** de tabela → só a barra da imagem, como antes.

- [ ] **Step 4: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
git add src/components/ProvaEditor/TableFloatingToolbar.tsx
git commit -m "fix(prova): barra da tabela nao cobre mais a barra da imagem na celula"
```

---

### Task 4: Painel de bordas e balde na barra flutuante (portal2-next)

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/TableFloatingToolbar.tsx` — imports (`:1-5`), `BORDER_PRESETS` (`:8-14`), corpo de `FloatingBody` (`:49-51`), bloco da cor de fundo (`:217-232`), bloco de bordas (`:244-276`)

**Interfaces:**
- Consumes: props `borderPreset`, `borderColor`, `blockIndex` que `FloatingBody` já recebe.
- Produces: nada.

- [ ] **Step 1: Imports**

Trocar a linha 1 e acrescentar os ícones:

```tsx
import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, ButtonGroup } from '@heroui/react';
import {
  TbBorderAll,
  TbBorderOuter,
  TbBorderHorizontal,
  TbBorderVertical,
  TbBorderNone,
  TbBucketDroplet,
} from 'react-icons/tb';
```

- [ ] **Step 2: Presets com ícone**

Substituir o `BORDER_PRESETS` das linhas 8-14 por:

```tsx
/**
 * Presets de borda — vocabulário nativo do w:tblBorders do Word.
 *
 * `TbBorderAll` é o quadrado dividido em quatro do Word/Docs (path: quadrado +
 * `M4 12l16 0` + `M12 4l0 16`). NÃO trocar por `TbTable`/`TbGrid3x3`: são
 * grades de 9 células, outro desenho.
 */
const BORDER_PRESETS: Array<{
  key: TableBorderPreset;
  label: string;
  Icon: React.ComponentType;
}> = [
  { key: 'all', label: 'Todas', Icon: TbBorderAll },
  { key: 'outer', label: 'Só externas', Icon: TbBorderOuter },
  { key: 'horizontal', label: 'Só horizontais', Icon: TbBorderHorizontal },
  { key: 'vertical', label: 'Só verticais', Icon: TbBorderVertical },
  { key: 'none', label: 'Nenhuma', Icon: TbBorderNone },
];
```

- [ ] **Step 3: Estado e fechamento do painel**

Dentro de `FloatingBody`, junto do `const [rect, setRect] = useState<Rect | null>(null);` (linha 50) — **antes** de qualquer `return` antecipado, para a ordem dos hooks não mudar:

```tsx
    const [bordersOpen, setBordersOpen] = useState(false);
    const bordersRef = useRef<HTMLDivElement>(null);

    // Fecha no clique fora e no Esc. `globalThis.MouseEvent` porque `MouseEvent`
    // solto neste arquivo é o tipo do React, não o do DOM.
    useEffect(() => {
      if (!bordersOpen) return;
      const onDown = (e: globalThis.MouseEvent) => {
        if (bordersRef.current?.contains(e.target as Node)) return;
        setBordersOpen(false);
      };
      const onKey = (e: globalThis.KeyboardEvent) => {
        if (e.key === 'Escape') setBordersOpen(false);
      };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [bordersOpen]);
```

- [ ] **Step 4: Balde no colorpicker de fundo**

No `<label>` da cor de fundo (linha 217), acrescentar o ícone antes do comentário e do `<input>`:

```tsx
          <label
            className="flex cursor-pointer items-center gap-1 text-xs text-zinc-600"
            title="Cor de fundo da célula"
          >
            <TbBucketDroplet aria-hidden />
            {/* key = célula ativa: input remonta ao trocar de célula, então o
                defaultValue reflete a cor da célula corrente (mesmo padrão do
                TableMenu, que remonta ao abrir). */}
            <input
              key={cellKey}
              type="color"
              defaultValue={cellBg ?? '#ffffff'}
              onChange={(e) => ed().setCellBackground(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-zinc-300 p-0.5"
              aria-label="Cor de fundo da célula"
            />
          </label>
```

- [ ] **Step 5: Gatilho + painel no lugar dos dois controles soltos**

Substituir tudo do comentário `{/* Bordas: ... */}` (linha 244) até o fechamento do `<label>` da "Cor da borda" (linha 276) por:

```tsx
          {/* Bordas: o preset muda só a COR de cada lado (nunca a espessura),
              então trocar de preset não reflui o texto nem move a paginação.
              Painel é <div> filho da barra, NUNCA Popover do HeroUI: portal
              cairia fora do onMouseDown guard abaixo, colapsaria a seleção do
              editor, getTableLocation() viraria null e a barra desmontaria
              levando o painel junto. */}
          <div ref={bordersRef} className="relative">
            <Button
              isIconOnly
              size="sm"
              variant={bordersOpen ? 'solid' : 'flat'}
              color={bordersOpen ? 'primary' : 'default'}
              disableRipple
              disableAnimation
              title="Bordas da tabela"
              aria-label="Bordas da tabela"
              aria-expanded={bordersOpen}
              onPress={() => setBordersOpen((v) => !v)}
            >
              <TbBorderAll />
            </Button>
            {bordersOpen && (
              <div
                className={`absolute left-1/2 z-10 w-max -translate-x-1/2 rounded border border-zinc-200 bg-white p-2 shadow-md ${
                  placeAbove ? 'bottom-full mb-2' : 'top-full mt-2'
                }`}
              >
                <div className="grid grid-cols-2 gap-1">
                  {BORDER_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      size="sm"
                      variant={borderPreset === p.key ? 'solid' : 'flat'}
                      color={borderPreset === p.key ? 'primary' : 'default'}
                      disableRipple
                      disableAnimation
                      aria-pressed={borderPreset === p.key}
                      startContent={<p.Icon />}
                      className="justify-start"
                      onPress={() => ed().setTableBorderPreset(p.key)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <hr className="my-2 border-zinc-200" />
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <span className="flex-1">Cor da linha</span>
                  <input
                    key={`bc:${blockIndex}`}
                    type="color"
                    defaultValue={borderColor ?? TABLE_BORDER_COLOR}
                    onChange={(e) => ed().setTableBorderColor(e.target.value)}
                    className="h-7 w-9 cursor-pointer rounded border border-zinc-300 p-0.5"
                    aria-label="Cor da linha da borda"
                  />
                  <Button
                    size="sm"
                    variant="flat"
                    disableRipple
                    disableAnimation
                    onPress={() => ed().setTableBorderColor(null)}
                  >
                    Padrão
                  </Button>
                </div>
              </div>
            )}
          </div>
```

`placeAbove` já está calculado na linha 119 do mesmo escopo. Nenhum `onPress` aqui fecha o painel.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
./node_modules/.bin/tsc --noEmit
```

Esperado: sem erro novo em `TableFloatingToolbar.tsx`.

- [ ] **Step 7: Verificar no clique de verdade**

`npm run dev`, abrir uma prova, clicar numa célula e:

1. A barra mostra `[🪣▮] [Sem cor] [⊞] [Excluir tabela]` — os dois quadradinhos de cor idênticos sumiram, sobrou um só, com balde.
2. Clicar no `⊞` → painel abre **para cima** (a barra está acima da tabela), sem cobrir a tabela.
3. Clicar em "Só externas" → **as duas coisas juntas**: painel continua aberto E o destaque pulou de "Todas" para "Só externas". Se não pular, pare — é o risco de controlado do spec.
4. Clicar em "Nenhuma" → bordas somem, painel aberto.
5. Mexer na "Cor da linha" → bordas mudam de cor, painel aberto.
6. "Padrão" → volta à cor padrão, painel aberto.
7. `Esc` fecha o painel; clicar fora fecha o painel.
8. Depois de cada clique no painel, digitar na célula → o caret ainda está lá. (Confirma que o painel não colapsou a seleção do editor.)
9. Rolar a página com o painel aberto → a barra acompanha a tabela e o painel vai junto.

- [ ] **Step 8: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
git add src/components/ProvaEditor/TableFloatingToolbar.tsx
git commit -m "feat(prova): bordas da barra flutuante saem do select e abrem do icone"
```

---

### Task 5: Disclosure inline no `CustomToolbar` (portal2-next)

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/CustomToolbar.tsx:1` (imports React), `:23-46` (imports de ícones), `:48-54` (`BORDER_PRESETS`), `:223-230` (corpo de `TableMenuRaw`), `:292-321` (bloco de bordas)

**Interfaces:**
- Consumes: `editorRef.current` (`EditorCtx`), `TableBorderPreset`, `TABLE_BORDER_COLOR` — todos já importados no arquivo.
- Produces: nada.

- [ ] **Step 1: Imports**

Linha 1 vira:

```tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Depois do bloco de imports de `react-icons/fa6` (termina na linha 46), acrescentar:

```tsx
import {
  TbBorderAll,
  TbBorderOuter,
  TbBorderHorizontal,
  TbBorderVertical,
  TbBorderNone,
} from 'react-icons/tb';
```

- [ ] **Step 2: Presets com ícone**

Substituir o `BORDER_PRESETS` das linhas 48-54 por:

```tsx
/**
 * Presets de borda da tabela — vocabulário nativo do w:tblBorders do Word.
 *
 * `TbBorderAll` é o quadrado dividido em quatro do Word/Docs. NÃO trocar por
 * `TbTable`/`TbGrid3x3`: são grades de 9 células, outro desenho.
 */
const BORDER_PRESETS: Array<{
  key: TableBorderPreset;
  label: string;
  Icon: React.ComponentType;
}> = [
  { key: 'all', label: 'Todas', Icon: TbBorderAll },
  { key: 'outer', label: 'Só externas', Icon: TbBorderOuter },
  { key: 'horizontal', label: 'Só horizontais', Icon: TbBorderHorizontal },
  { key: 'vertical', label: 'Só verticais', Icon: TbBorderVertical },
  { key: 'none', label: 'Nenhuma', Icon: TbBorderNone },
];
```

- [ ] **Step 3: Estado do painel — com espelho do preset**

Dentro de `TableMenuRaw`, junto dos `useState` existentes (linhas 224-226):

```tsx
  const [bordersOpen, setBordersOpen] = useState(false);
  // Espelho local do preset. `TableMenu` é memoizado numa prop que é um ref
  // estável, então ele NÃO re-renderiza quando o modelo muda — ler
  // getTableBorderPreset() no render deixaria o destaque congelado no valor de
  // quando o menu abriu. O espelho é o que faz o botão ativo acompanhar.
  const [preset, setPreset] = useState<TableBorderPreset>('all');

  // Ao abrir o menu, semear o espelho com o preset da tabela corrente; ao
  // fechar, recolher o painel para reabrir no estado neutro.
  useEffect(() => {
    if (!open) {
      setBordersOpen(false);
      return;
    }
    const ed = editorRef.current;
    if (ed?.isInTable()) setPreset(ed.getTableBorderPreset());
  }, [open, editorRef]);
```

- [ ] **Step 4: Gatilho + painel no lugar das três linhas**

Substituir tudo entre o `<hr />` da linha 292 e o `</Button>` do "Restaurar cor da borda" (linha 321) por:

```tsx
              <hr />
              {/* Bordas: o preset muda só a COR de cada lado (nunca a espessura),
                  então trocar de preset não reflui o texto nem move a paginação.
                  Disclosure inline em vez de Popover aninhado: PopoverContent do
                  HeroUI é portal, e clicar num portal colapsaria a seleção do
                  editor. */}
              <Button
                isIconOnly
                size="sm"
                variant={bordersOpen ? 'solid' : 'flat'}
                color={bordersOpen ? 'primary' : 'default'}
                disableRipple
                disableAnimation
                title="Bordas da tabela"
                aria-label="Bordas da tabela"
                aria-expanded={bordersOpen}
                onPress={() => setBordersOpen((v) => !v)}
              >
                <TbBorderAll />
              </Button>
              {bordersOpen && (
                <div className="rounded border border-zinc-200 bg-zinc-50 p-2">
                  <div className="grid grid-cols-2 gap-1">
                    {BORDER_PRESETS.map((p) => (
                      <Button
                        key={p.key}
                        size="sm"
                        variant={preset === p.key ? 'solid' : 'flat'}
                        color={preset === p.key ? 'primary' : 'default'}
                        disableRipple
                        disableAnimation
                        aria-pressed={preset === p.key}
                        startContent={<p.Icon />}
                        className="justify-start"
                        onPress={() => {
                          editor().setTableBorderPreset(p.key);
                          setPreset(p.key);
                        }}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                  <hr className="my-2 border-zinc-200" />
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
                    <span className="flex-1">Cor da linha</span>
                    <input
                      type="color"
                      defaultValue={editor().getTableBorderColor() ?? TABLE_BORDER_COLOR}
                      onChange={(e) => editor().setTableBorderColor(e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border border-zinc-300 p-0.5"
                      aria-label="Cor da linha da borda"
                    />
                    <Button
                      size="sm"
                      variant="flat"
                      disableRipple
                      disableAnimation
                      onPress={() => editor().setTableBorderColor(null)}
                    >
                      Padrão
                    </Button>
                  </label>
                </div>
              )}
```

Nenhum `onPress` aqui chama `setOpen(false)` — nem os presets, nem a cor, nem o "Padrão", que **hoje fecha** e deixa de fechar.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
./node_modules/.bin/tsc --noEmit
```

Esperado: sem erro novo em `CustomToolbar.tsx`.

- [ ] **Step 6: Verificar no clique de verdade**

`npm run dev`, abrir uma prova, clicar numa célula de tabela, abrir o menu ▦ e:

1. Onde havia "Bordas", "Cor da borda" e "Restaurar cor da borda" há **um botão-ícone** `⊞` só.
2. Clicar nele → o painel expande abaixo, empurrando o "Excluir tabela" para baixo; o menu ▦ não fecha.
3. Clicar em "Só externas" → **as duas coisas**: menu e painel seguem abertos E o destaque pulou. Se não pular, o espelho do Step 3 não está funcionando.
4. Fechar o menu ▦ e reabrir → o painel está recolhido e o destaque mostra o preset que está valendo na tabela (não "Todas" fixo).
5. Cor da linha e "Padrão" → funcionam sem fechar o menu.
6. Abrir o menu com a tabela perto do rodapé da janela → o popover do HeroUI reposiciona ao expandir, em vez de cortar o painel.

- [ ] **Step 7: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
git add src/components/ProvaEditor/CustomToolbar.tsx
git commit -m "feat(prova): bordas da tabela no menu principal abrem do icone"
```

---

### Task 6: Espelhar em `frequencia-ocorrencia`

**Files:**
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/TableFloatingToolbar.tsx`
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx`

**Interfaces:** nenhuma — é cópia.

- [ ] **Step 1: Copiar o `TableFloatingToolbar` inteiro**

Os dois eram byte a byte idênticos antes das Tasks 3 e 4, então copiar é seguro:

```bash
cp /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/TableFloatingToolbar.tsx \
   /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/TableFloatingToolbar.tsx
```

- [ ] **Step 2: Confirmar que ficaram idênticos**

```bash
diff /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/TableFloatingToolbar.tsx \
     /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/TableFloatingToolbar.tsx \
  && echo IDENTICOS
```

Esperado: `IDENTICOS`.

- [ ] **Step 3: Copiar o `CustomToolbar` e restaurar a única linha divergente**

Os dois `CustomToolbar.tsx` divergem em **uma linha só**: o `frequencia-ocorrencia`
não tem o `as any` no cast de `level`. Transcrever ~120 linhas à mão convida a
erro, então o caminho seguro é copiar tudo e desfazer essa única linha.

Antes de copiar, guardar a linha que tem que voltar:

```bash
grep -n "opt.level !== undefined" /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx
```

Esperado: `734:      opt.level !== undefined ? { level: opt.level } : undefined,` (sem `as any`).

Copiar e reverter só ela:

```bash
cp /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/CustomToolbar.tsx \
   /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx

cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
perl -pi -e 's/\Qopt.level !== undefined ? ({ level: opt.level } as any) : undefined,\E/opt.level !== undefined ? { level: opt.level } : undefined,/' \
  src/components/ProvaEditor/CustomToolbar.tsx
```

- [ ] **Step 4: Confirmar que sobrou exatamente um hunk de diferença**

```bash
diff /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/CustomToolbar.tsx \
     /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx
```

Esperado: **um só hunk**, o do `as any`. Zero hunks significa que o `perl` não
casou e o `as any` vazou para o app errado — corrigir antes de seguir. Mais de um
hunk significa que os arquivos divergiram desde a medição — parar e investigar.

- [ ] **Step 5: Build**

Este app não tem `tsc` instalado localmente; o `vite build` é a verificação disponível.

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
npm run build
```

Esperado: build conclui sem erro de import ou de sintaxe.

- [ ] **Step 6: Verificar no navegador**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
npm run dev
```

Repetir os roteiros dos Steps 7 da Task 4 e 6 da Task 5, mais o roteiro do Step 3 da Task 3 (imagem na célula). É outro app com outra versão do HeroUI (2.7.6 vs 2.7.2) — não confiar em "funcionou lá".

- [ ] **Step 7: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
git add src/components/ProvaEditor/TableFloatingToolbar.tsx src/components/ProvaEditor/CustomToolbar.tsx
git commit -m "feat(prova): espelha bordas atras do icone e guard da barra de imagem"
```

---

## Ordem e dependências

```
Task 1 (componente + teste)
   └─> Task 2 (Toolbar.tsx + CSS)

Task 3 (guard do embed)      ← independente, pode ir primeiro de tudo
Task 4 (painel na flutuante) ← mesmo arquivo da Task 3; fazer depois dela
Task 5 (CustomToolbar)       ← independente da 3 e da 4

Tasks 3, 4 e 5 ─> Task 6 (espelhar)
```

A Task 3 é a única que corrige um defeito visível hoje na produção e não depende de nada. Se for para entregar em pedaços, ela vai sozinha primeiro.
