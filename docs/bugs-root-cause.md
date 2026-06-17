# Bugs do Editor — Mapa de Causa-Raiz (hipóteses)

> Investigação read-only (sem reprodução). Cada item é **hipótese** com referência de arquivo:linha.
> Confiança: 🟢 alta (causa localizada no código) · 🟡 média (mecanismo plausível, falta repro) · 🔴 a confirmar.

## Clusters (vários bugs = mesma causa)

- **A. Clipboard inexistente** → #7, #8, #14. Não há handlers `onCopy`/`onCut`; o paste só lê `text/plain`. Um único módulo de clipboard resolve os três.
- **B. Comentários são do app host** → #2, #3, #5. Este monorepo só guarda marks inline; a sidebar/resolver/card vivem no app consumidor. Repo só entrega *enablers* (hook observer de Y.Doc + persistir texto citado).
- **C. Stacking/clipping de imagem posicionada** → #4, #9. `isolation: isolate` por bloco + `overflow: hidden` na página recortam imagens "frente"/"atrás".
- **D. Estado de seleção** → #1, #6. Race entre seleção do modelo e snapshot do DOM (#1) e perda da seleção ao abrir dialog (#6).

---

## Detalhe por bug

### #1 — Cursor volta ao digitar rápido 🟡
Mismatch de fase: `insertText` avança a seleção **síncrono** (`core/commands.ts:69`), mas o snapshot é adiado para `requestAnimationFrame` (`react/useEditor.ts:254-256`). Sob digitação rápida, `useLayoutEffect` (`react/Editor.tsx:144-156`) re-aplica a seleção contra texto velho; `locatePoint` estoura o offset e cai no fallback `{node:container, offset:0}` (`react/dom-bridge.ts:371-375`); o handler de `selectionchange` (`Editor.tsx:158-170`) grava esse offset 0 de volta no modelo.
**Fix:** suprimir o write-back de `selectionchange` enquanto há flush de snapshot pendente, ou versionar a seleção pelo snapshot.

### #2 — Caixas de comentário não aparecem em tempo real 🟢 (host)
A lista de comentários (no app host) não assina mudanças do Y.Doc; só re-renderiza quando o próprio estado do backend muda (ex.: ao resolver outro). No repo, a única assinatura de doc é `useEditor.ts:234-273`, que só dirige snapshot.
**Fix (repo):** exportar um hook que observa o Y.Doc e expõe o conjunto vivo de markIds.

### #3 — Resolver não atualiza em tempo real 🟢 (host)
Mesma causa de #2. `CommentAttr` (`core/types.ts:119-122`) nem tem flag `resolved`; o estado resolvido é externo e só atualiza num refetch em lote.
**Fix (repo):** mesmo observer de #2, ou estender `CommentAttr` com `resolved`.

### #5 — Ao resolver, não mostra o texto que originou o comentário 🟢
`CommentAttr` guarda só `markId` (`core/types.ts:119-122`), nunca o texto citado. Ao resolver/remover o mark, o vínculo markId→texto se perde. Não há helper "achar texto por markId" (`core/marks.ts` é por range).
**Fix (repo):** estender `CommentAttr` para `{ markId, quotedText }` e capturar o texto na criação.

### #4 — Botão imagem "frente do texto" não funciona 🟢
Botão e persistência estão corretos (`react/Toolbar.tsx:191-207`, `setImageAttrs`). O problema é CSS: `.ed-block { isolation: isolate }` (`apps/playground/src/styles.css:574-577`) cria stacking context por bloco, prendendo o `z-index:2` da imagem (`react/renderInline.tsx:170`); blocos seguintes pintam por cima.
**Fix:** aplicar `isolation` só em blocos com imagem "behind", ou renderizar imagens "front" num layer único em `.ed-page-content`.

### #7 — Ctrl+C em imagem não funciona 🟢 (cluster A)
Não há `onCopy`/`onCut` no contenteditable (`react/Editor.tsx`). A seleção de embed é nível-modelo (`useEditor.ts:589-617`), sem Range de DOM; o copy nativo não tem o que copiar.
**Fix:** handler `onCopy`/`onCut` que serializa o embed para o clipboard quando `getSelectedEmbed()` retorna algo.

### #8 — Paste cola sem formatação 🟢 (cluster A)
Paste lê só `text/plain` (`react/Editor.tsx:441`) e não existe `onCopy` para escrever marks no clipboard.
**Fix:** `onCopy` serializa o range (com marks) num MIME custom; paste tenta esse MIME antes de cair em `text/plain`.

### #9 — Imagem some atrás da paginação ao cruzar página 🟡 (cluster C)
Imagem absoluta é ancorada ao padding-box do bloco (`react/renderInline.tsx:163-171`); `.ed-page`/`.ed-page-content` têm `overflow:hidden` (`styles.css:191,201`), recortando o que invade a página seguinte; ordem de pintura das páginas agrava.
**Fix:** renderizar imagens posicionadas num overlay em `.ed-root` (acima das páginas) e/ou revisar `overflow` da página.

### #11 — Legenda na imagem fica lagada 🟡
Adicionar legenda muda `<img>`→`<figure>`: invalida cache de medição de linha (`react/usePagination.ts:409`, key = `offsetWidth|text`), força re-measure (`usePagination.ts:306`) e re-render do `ImageEmbedView` (`renderInline.tsx:104-125`); remount do `<img>` com `decoding="sync"` em data-URL grande re-decodifica.
**Fix:** incluir presença de legenda no structural key (re-measure uma vez), `decoding="async"`, e/ou legenda fora do fluxo de medição.

### #14 — Ctrl+X copia em vez de recortar 🟢 (cluster A)
Sem `onCut` (`react/Editor.tsx`): o browser copia por padrão mas o editor nunca chama `deleteRange`.
**Fix:** `onCut` serializa a seleção e chama `deleteRange(ctx, selection)`.

### #6 — Inserir link em texto selecionado não funciona 🟡 (cluster D)
Lógica de aplicar mark parece correta (`useEditor.ts:382-394` → `cmdSetMark`), mas `setMark` retorna cedo se a seleção está colapsada (`core/commands.ts:273`). Ao abrir o LinkDialog/clicar o botão, o contenteditable perde foco e a seleção colapsa, então o href não é aplicado ao range original.
**Fix:** salvar/encodar a seleção antes de abrir o dialog e restaurá-la antes do `setMark`.

### #15 — Alinhamento dentro de tabela não funciona 🟢
Bloqueado em 3 camadas: `setBlockAttr` retorna cedo p/ célula (`core/commands.ts:347`, checa `cellIndex`); `CellAttrs` não tem `align` (`core/types.ts:66-83`); `TableView` não aplica `textAlign` no `<td>` (`react/NodeView.tsx:197-209`).
**Fix:** add `align` em `CellAttrs` + comando cell-aware + aplicar `style.textAlign` no `<td>`.

### #16 — Não consegue escrever abaixo da tabela 🟢
`insertTable` não acrescenta parágrafo final (`core/commands.ts:617-631`); se a tabela vira último bloco, o caret não tem onde ir. Padrão "garantir parágrafo" já existe em `deleteTable` (`commands.ts:639`).
**Fix:** após inserir, se a tabela for o último bloco, append de parágrafo vazio.

### #17 — Remover cursores ao imprimir 🟢
`serializePaginatedHtml` clona o DOM vivo e remove só `.ed-image-overlay`, não `.ed-remote-cursors` (`export-pdf/src/pdf.ts:76-81,106`). Usado tanto no print (`App.tsx:54`) quanto no snapshot (`saveSnapshot.ts:37`).
**Fix:** remover `.ed-remote-cursors` do clone, ou `display:none !important` no CSS de print.
