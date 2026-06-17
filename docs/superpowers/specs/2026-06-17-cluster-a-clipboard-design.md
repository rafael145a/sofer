# Spec — Cluster A: Clipboard (copy / cut / paste)

**Data:** 2026-06-17
**Bugs:** #7 (Ctrl+C em imagem não funciona), #8 (paste cola sem formatação), #14 (Ctrl+X copia em vez de recortar)
**Origem:** `docs/bugs-root-cause.md` (cluster A — "Clipboard inexistente")

## Escopo (decisões aprovadas)

- **Interop:** interno **lossless** (marks + imagens) via MIME custom; sai como **texto puro** para apps externos; colar DE fora vira texto puro (sem importar formatação HTML).
- **Estrutura:** rich dentro do bloco + seleção **multi-bloco preserva tipo/attrs** de cada bloco (parágrafo, título, citação, item de lista). Tabela: só texto de **uma** célula; seleção retangular entre células fica **fora** da v1.
- **Abordagem:** A1 — o "slice" do clipboard reaproveita `SerializedBlock[]` + flags `openStart`/`openEnd`.

## Causa-raiz (confirmada no código)

- Paste chega como `beforeinput` `insertFromPaste` (`packages/react/src/Editor.tsx:430`) e lê **só `text/plain`** → split em parágrafos → `insertText` (puro, sem marks). → #8.
- **Não existe handler `copy`/`cut`** — o default do browser serializa a seleção do DOM (perde fidelidade do modelo) e nunca deleta no cut. → #7, #14.
- Core tem `sliceDelta`, `getMarksInRange`, `deleteRange` (interno) mas **nenhuma primitiva de inserir delta rico**. Embeds de imagem são `DeltaOp` no texto (`getSelectedEmbed`, `isImageEmbed`).

---

## Arquitetura

Lógica de modelo em `@sofereditor/core`; eventos de clipboard do DOM em `@sofereditor/react`.

### Tipo do slice (`packages/core/src/clipboard.ts`, novo)

```ts
import type { SerializedBlock } from "./types";

export interface ClipboardSlice {
  blocks: SerializedBlock[]; // 1..n; deltas carregam marks + embeds de imagem
  openStart: boolean;        // 1º bloco é fragmento parcial → mescla inline no alvo
  openEnd: boolean;          // último bloco é fragmento parcial → conteúdo após o caret continua nele
}

export const SOFER_MIME = "application/x-sofer-slice";
```

Três casos, representados de forma uniforme:
- **Dentro de um bloco** (#8): `blocks=[S0]`, `openStart=openEnd=true`.
- **Imagem única** (#7): `blocks=[S0]` com `delta=[embed]`, `openStart=openEnd=true`.
- **Multi-bloco**: 1º parcial (`openStart`), blocos do meio inteiros, último parcial (`openEnd`); `type`/`attrs` preservados.

### Componentes

| Unidade | Local | Responsabilidade |
|---|---|---|
| `serializeSelection(doc, sel) → ClipboardSlice \| null` | core/clipboard.ts | seleção → slice; `null` se colapsada ou multi-célula |
| `sliceToText(slice) → string` | core/clipboard.ts | fallback texto puro (textos dos blocos unidos por `\n`) |
| `sliceToInlineDelta(slice) → DeltaOp[]` | core/clipboard.ts | achata o slice em delta inline (para colar em célula) |
| `insertSlice(ctx, slice)` | core/commands.ts | substitui a seleção pelo slice (regra de merge abaixo) |
| `deleteSelection(ctx)` | core/commands.ts | expõe o `deleteRange` interno (usado pelo cut) |
| `onCopy`/`onCut`/`onPaste` | react/Editor.tsx | eventos de clipboard ↔ core; escreve/lê `SOFER_MIME` + `text/plain` |

Exports saem via `export * from "./clipboard"` e `"./commands"` no `index.ts` (automático).

---

## `serializeSelection`

```
sel colapsada → null
sel com anchor/focus em células diferentes (multi-célula) → null
caso contrário:
  ordena (start, end)
  se start.blockIndex === end.blockIndex:
    delta = sliceDelta(textoDoBloco.toDelta(), start.offset, end.offset)
    blocks = [{ type, attrs, text: textoDe(delta), delta }]
  senão (multi-bloco):
    primeiro = sliceDelta(blocoStart, start.offset, fim)         // parcial à direita
    meio[i]  = delta inteiro dos blocos start+1..end-1
    ultimo   = sliceDelta(blocoEnd, 0, end.offset)               // parcial à esquerda
    blocks = [primeiro, ...meio, ultimo] com type/attrs de cada bloco origem
  openStart = start.offset > 0
  openEnd   = end.offset < (comprimento do último bloco da seleção)
```
Imagem única: a seleção do embed tem largura 1 (offset..offset+1) num só bloco → cai no ramo "mesmo bloco", `delta=[embed]`.

## `insertSlice(ctx, slice)` — regra de merge

Seja o caret em offset `O` no bloco alvo `T` (delta `Dt`), dentro de uma transação:

1. Se a seleção não está colapsada → `deleteRange` primeiro → caret colapsa em `O`.
2. **Alvo é célula de tabela** → insere `sliceToInlineDelta(slice)` no offset `O` da célula (achata; sem estrutura de bloco). Caret após o inline. Fim.
3. Split `Dt` em `Dhead` (0..O) e `Dtail` (O..fim).
4. **Single block** (`blocks.length===1`): `T.delta = Dhead + S0.delta + Dtail`; `T` mantém type/attrs; caret em `len(Dhead)+len(S0.delta)`. (#8 e #7)
5. **Multi-bloco** (`S0..Sk`, `k≥1`):
   - 1º: `openStart` → `T.delta = Dhead + S0.delta` (T mantém seu type). senão → `T.delta = Dhead`; `S0` inteiro inserido como novo bloco após T.
   - meio `S1..S(k-1)`: inseridos inteiros (type/attrs/delta).
   - último: `openEnd` → novo bloco final com type/attrs de `Sk` e delta `Sk.delta + Dtail`. senão → `Sk` inteiro; depois `Dtail` vira bloco próprio (type original de T).
   - caret na junção entre o conteúdo colado e `Dtail`.

> **Primitivas já existem** (não precisa inventar): `writeDeltaInto(yText, pos, delta)` em `commands.ts` reaplica um delta com marks+embeds preservados (usado por `mergeRight`) — é o que insere `S.delta`/`Dhead`/`Dtail` num `Y.Text`. `createBlock(type, "", attrs)` cria bloco com type+attrs (mescla com defaults). `sliceDelta` corta os fragmentos. `deleteRange` (interno) remove o range. O plano fixa as chamadas exatas a partir dessas.

## `deleteSelection(ctx)`

Expõe o `deleteRange(doc, sel)` interno como comando público: deleta o range e faz `ctx.setSelection` no resultado colapsado. Usado pelo `onCut`.

---

## React: handlers de clipboard (`packages/react/src/Editor.tsx`)

Registrados no root contenteditable (via `addEventListener`, como o `beforeinput`):

- **copy:** `slice = serializeSelection(doc, sel)`. Se `null` → não faz nada (deixa default). Senão `e.preventDefault()`; `e.clipboardData.setData(SOFER_MIME, JSON.stringify(slice))` + `setData("text/plain", sliceToText(slice))`.
- **cut:** igual ao copy; se houve slice → também `deleteSelection(ctx)`.
- **paste:** `e.preventDefault()`; ordem:
  1. `raw = e.clipboardData.getData(SOFER_MIME)`. Se não-vazio: `try { slice = JSON.parse(raw); validar (blocks é array) ; insertSlice(ctx, slice) } catch { cai pro passo 3 }`.
  2. senão, arquivos de imagem (`clipboardData.files` com `type image/*`) → `insertImageFromFile` (lógica movida do `beforeinput`).
  3. senão, `text/plain` → comportamento atual (split por `\n`, `insertParagraph`+`insertText`).
- O case `insertFromPaste` do `beforeinput` é reduzido a `preventDefault()` + comentário apontando pro `onPaste` (não dispara porque o `paste` já fez `preventDefault`).

### Tratamento de erro
- Paste com `SOFER_MIME` malformado → `JSON.parse`/validação em `try/catch` → fallback pro `text/plain`. Nunca lança no editor.
- copy/cut com seleção colapsada → `serializeSelection` `null` → no-op.

---

## Estratégia de testes

**Unit (core, vitest) — `packages/core/src/__tests__/clipboard.test.ts`:**
- `serializeSelection`: rich dentro do bloco (marks no delta); embed único; multi-bloco (flags `openStart`/`openEnd` corretas); colapsada → `null`; multi-célula → `null`.
- `insertSlice` round-trip (serializa numa seleção → insere noutro ponto → confere blocks/delta): marks dentro do bloco; embed; merge multi-bloco (open/open); paste de blocos inteiros → blocos discretos; paste em célula → achata inline.
- `deleteSelection`: remove range + caret correto. `sliceToText`: junção por `\n`.

**Verificação no playground (Chrome) — sem harness de DOM no react:**
- #8: copiar texto em negrito → colar → negrito preservado.
- #14: recortar texto → some do ponto original → colar noutro lugar → reaparece.
- #7: copiar imagem selecionada → colar → imagem duplicada.

---

## Arquivos

- `packages/core/src/clipboard.ts` (novo): `ClipboardSlice`, `SOFER_MIME`, `serializeSelection`, `sliceToText`, `sliceToInlineDelta`.
- `packages/core/src/commands.ts`: `insertSlice`, `deleteSelection`.
- `packages/core/src/__tests__/clipboard.test.ts` (novo).
- `packages/react/src/Editor.tsx`: handlers `onCopy`/`onCut`/`onPaste`; simplificar case `insertFromPaste`.
- `packages/core/src/index.ts`: sem edição (re-export automático via `export *`).

## Fora de escopo
- Importar formatação de HTML externo (colar do Word/web mantém só texto).
- Escrever `text/html` no clipboard (saída formatada para apps externos).
- Cópia/cola retangular de células de tabela.
- Clusters B/C/D e #11.

## Ordem de implementação sugerida
1. core `clipboard.ts` (serializeSelection + sliceToText + sliceToInlineDelta) + testes.
2. core `deleteSelection` + `insertSlice` + testes (round-trip).
3. react handlers `onCopy`/`onCut`/`onPaste` + simplificar `insertFromPaste`.
4. Verificação no playground (#7/#8/#14).
