import type {
  AlignValue,
  BlockAttrs,
  BlockType,
  ClipboardSlice,
  DeltaOp,
  ListKind,
  MarkAttrs,
  SerializedBlock,
} from "@sofereditor/core";
import { MAX_LIST_LEVEL } from "@sofereditor/core";

/**
 * Converte o HTML do clipboard (Word / Google Docs / navegador) num
 * `ClipboardSlice` que o editor já sabe inserir via `insertSlice`.
 *
 * Sempre bloco-inteiro: `openStart`/`openEnd` são `false` e `blockLevel` é
 * `true` — o conteúdo colado de fora não é um fragmento de um dos blocos do
 * editor, é uma sequência de blocos novos. `blockLevel: true` é o que diz a
 * `insertSlice` (em `@sofereditor/core`) para adotar type/attrs do bloco
 * colado em vez de tratá-lo como fragmento de seleção — ver o comentário em
 * `ClipboardSlice.blockLevel`.
 *
 * Retorna `null` quando não sobra nada aproveitável, para o chamador (`Editor.tsx`)
 * cair no ramo de texto puro em vez de engolir a colagem.
 *
 * Duas armadilhas reais que este módulo trata explicitamente (ver testes):
 *  - Google Docs embrulha o documento inteiro num `<b style="font-weight:normal"
 *    id="docs-internal-guid-...">` — uma tag inline por fora de blocos inteiros.
 *    `hasBlockDescendant` detecta isso e trata o wrapper como transparente
 *    (propaga as marcas resolvidas, mas não achata os blocos internos).
 *  - Word não usa `<ul>/<ol>/<li>` — usa `<p style="mso-list:l0 level1 ...">`
 *    com o marcador (número/símbolo) como texto literal dentro de um span
 *    `mso-list:Ignore`. `parseWordListLevel` + a exclusão desse span tratam isso.
 *
 * fontFamily é deliberadamente NUNCA emitida: a escola padroniza Arial e cada
 * documento tem sua própria tipografia (mesma decisão de `import-docx`, que
 * descarta `w:rFonts`). fontSize É preservado (ver `parseFontSizePt`): o
 * modelo já suporta a mark, a barra já tem controle de tamanho, e descartar o
 * tamanho perdia informação real (título de 37.5pt colado do Google Docs saía
 * do tamanho do corpo). Unidades que dependem do contexto de herança do
 * documento de origem (em/rem/%/larger/smaller/medium) não são resolvíveis
 * aqui e por isso não emitem marca — sem tamanho é melhor que tamanho errado.
 */
export function htmlToSlice(html: string): ClipboardSlice | null {
  if (!html || html.trim().length === 0) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  const body = doc.body;
  if (!body) return null;

  const blocks: SerializedBlock[] = [];
  walkBlockLevel(body, {}, blocks);
  if (blocks.length === 0) return null;

  // Nada aproveitável = TODO bloco sem texto. Acontece quando o HTML só
  // carregava imagem, que este conversor ignora por escopo: o Word manda uma
  // imagem como `<p class=MsoNormal><img ...><o:p></o:p></p>`, o que produziria
  // um parágrafo vazio. Devolver esse parágrafo faria `planPaste` escolher o
  // ramo de HTML e a imagem seria DESCARTADA — colar imagem do Word passaria a
  // inserir uma linha em branco. Devolvendo null, a colagem segue para o ramo
  // de arquivos, que insere a imagem.
  //
  // Parágrafo vazio NO MEIO de conteúdo real é linha em branco de propósito e
  // continua preservado — a regra só descarta quando não sobrou texto nenhum.
  const temTexto = blocks.some((b) => b.text.trim().length > 0);
  if (!temTexto) return null;

  // `blockLevel: true` diz a `insertSlice` para ADOTAR o type/attrs do bloco
  // colado em vez de fazer splice inline (ver o comentário em `insertSlice`).
  // Isso só vale a pena quando o resultado tem mais de um bloco (é
  // inequivocamente uma sequência de blocos externa) OU quando o único bloco
  // NÃO é um parágrafo simples (heading/listItem/blockquote — adotar o tipo é
  // o ganho real). Um ÚNICO parágrafo — a forma mais comum de colagem curta,
  // vinda de nós inline soltos (site/Chrome `<span>`, Word `<p class=
  // MsoNormal><span>`, Docs `<b style="font-weight:normal">`) — NÃO é uma
  // "colagem de bloco inteiro" no sentido que importa aqui: marcar
  // `blockLevel` nesse caso faz `insertSlice` tratar até um trecho de duas
  // palavras como bloco externo, partindo o parágrafo do professor em três
  // (Dhead / bloco colado / tail) em vez de um splice inline, e — pior —
  // colar no offset 0 de um heading fazia `am.clear()` nos attrs do bloco
  // alvo, rebaixando o título a `paragraph`. Sem `blockLevel`, esse caso cai
  // no ramo de splice inline (comportamento de antes da branch); um bloco
  // único que É heading/listItem/blockquote continua adotando o tipo — o
  // ganho que motivou esta branch.
  const blockLevel = blocks.length > 1 || blocks[0].type !== "paragraph";
  return { blocks, openStart: false, openEnd: false, ...(blockLevel ? { blockLevel: true as const } : {}) };
}

// ---------------------------------------------------------------------------
// Classificação de tags
// ---------------------------------------------------------------------------

/** Tags cujo conteúdo nunca vira texto (script/style vazam pra dentro do body
 *  no HTML que o Google Docs cola; o:p/w:.../v:... são namespaces do Word). */
const IGNORED_TAGS = new Set(["script", "style", "meta", "link", "head", "title", "xml"]);

/** Tags "block-ish": sem filhos de bloco viram UM parágrafo; com filhos de
 *  bloco são tratadas como container transparente (ver `hasBlockDescendant`). */
const BLOCK_LEVEL_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "figure",
  "figcaption",
  "pre",
  "address",
]);

/** Tags que, se aparecerem como descendente direto ou indireto de um elemento
 *  não tratado explicitamente, forçam esse elemento a ser um container
 *  transparente em vez de uma corrida inline (caso do wrapper `<b>` do Docs). */
const BLOCK_TRIGGER_TAGS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "table",
  "tr",
  "td",
  "th",
]);

function isNamespacedTag(tag: string): boolean {
  return tag.includes(":");
}

function hasBlockDescendant(el: Element): boolean {
  const all = el.querySelectorAll("*");
  for (const e of Array.from(all)) {
    if (BLOCK_TRIGGER_TAGS.has(e.tagName.toLowerCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Walker de nível de bloco
// ---------------------------------------------------------------------------

function walkBlockLevel(container: Element, marks: MarkAttrs, blocks: SerializedBlock[]): void {
  let loose: ChildNode[] = [];
  const flushLoose = () => {
    if (loose.length === 0) return;
    const nodes = loose;
    loose = [];
    const delta = inlineDeltaFromNodes(nodes, marks);
    if (delta.length > 0) blocks.push(makeBlock("paragraph", delta, {}));
  };

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      loose.push(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (IGNORED_TAGS.has(tag) || isNamespacedTag(tag)) continue;

    switch (tag) {
      case "ul":
      case "ol": {
        flushLoose();
        handleList(el, tag === "ol" ? "ordered" : "bullet", 0, marks, blocks);
        break;
      }
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        flushLoose();
        const level = Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6;
        const attrs: BlockAttrs = { level };
        const align = readAlign(el);
        if (align) attrs.align = align;
        const delta = inlineDeltaFromNodes(Array.from(el.childNodes), marks);
        blocks.push(makeBlock("heading", delta, attrs));
        break;
      }
      case "blockquote": {
        flushLoose();
        handleBlockquote(el, marks, blocks);
        break;
      }
      case "table": {
        flushLoose();
        handleTable(el, marks, blocks);
        break;
      }
      case "li": {
        // <li> fora de <ul>/<ol> (defensivo) — trata como bullet nível 0.
        // Mesma exclusão de listas aninhadas do <li> normal (handleList):
        // sem isso, um <li> defensivo com filho <ul> vazaria o texto do
        // filho pro pai e perderia a estrutura de listItem do filho.
        flushLoose();
        const nestedLists = topLevelListDescendants(el);
        const clone = el.cloneNode(true) as Element;
        for (const l of topLevelListDescendants(clone)) l.remove();
        const delta = inlineDeltaFromNodes(Array.from(clone.childNodes), marks);
        blocks.push(makeBlock("listItem", delta, { listKind: "bullet", listLevel: 0 }));
        for (const nested of nestedLists) {
          const nestedKind: ListKind = nested.tagName.toLowerCase() === "ol" ? "ordered" : "bullet";
          handleList(nested, nestedKind, 1, marks, blocks);
        }
        break;
      }
      case "img":
        // Imagens são ignoradas neste caminho — colar imagem sozinha já
        // funciona pelo ramo de arquivos do clipboard.
        break;
      case "br":
        loose.push(node);
        break;
      default: {
        const styleAttr = el.getAttribute("style") ?? "";
        const wordListLevel = parseWordListLevel(styleAttr);
        if (wordListLevel != null && !hasBlockDescendant(el)) {
          flushLoose();
          const marker = findWordListMarker(el);
          const listKind: ListKind = marker ? detectWordListKind(marker) : "bullet";
          const attrs: BlockAttrs = { listKind, listLevel: wordListLevel };
          const align = readAlign(el);
          if (align) attrs.align = align;
          const delta = inlineDeltaFromNodes(Array.from(el.childNodes), marks);
          blocks.push(makeBlock("listItem", delta, attrs));
          break;
        }
        if (hasBlockDescendant(el)) {
          // Container transparente: tag inline (ou div) por fora de blocos
          // inteiros — caso clássico do wrapper do Google Docs. Propaga as
          // marcas resolvidas do próprio elemento para os blocos internos,
          // sem achatar a estrutura.
          flushLoose();
          let nextMarks = applyTagMarks(tag, marks);
          nextMarks = applyStyleMarks(el.getAttribute("style"), nextMarks);
          walkBlockLevel(el, nextMarks, blocks);
          break;
        }
        if (BLOCK_LEVEL_TAGS.has(tag)) {
          flushLoose();
          const attrs: BlockAttrs = {};
          const align = readAlign(el);
          if (align) attrs.align = align;
          const delta = inlineDeltaFromNodes(Array.from(el.childNodes), marks);
          blocks.push(makeBlock("paragraph", delta, attrs));
          break;
        }
        // Tag inline "solta" (span/b/i/a/font/...) sem filhos de bloco — junta
        // ao parágrafo corrente.
        loose.push(node);
      }
    }
  }
  flushLoose();
}

/**
 * Listas do Google Docs: `<ul>/<ol>` reais aninhados; nível = profundidade.
 *
 * Duas formas de aninhamento coexistem na prática e as duas têm que
 * funcionar:
 *  - Canônica: `<li>texto<ul>...</ul></li>` — a lista filha é descendente do
 *    `<li>` (direta, ou dentro de outro container como `<div>`).
 *  - Real do Google Docs: `<li>texto</li><ul>...</ul>` — a lista filha é
 *    IRMÃ do `<li>` dentro do mesmo `<ul>/<ol>` pai, não descendente dele.
 *    Sem tratar essa forma, o item aninhado inteiro some (não aparece nem
 *    como filho de outro bloco nem como block próprio).
 */
function handleList(
  listEl: Element,
  kind: ListKind,
  level: number,
  marks: MarkAttrs,
  blocks: SerializedBlock[],
): void {
  for (const child of Array.from(listEl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      // Forma "irmã": lista aninhada emitida como irmã do <li> anterior, não
      // dentro dele. Semanticamente ela pertence ao item anterior — sobe um
      // nível a partir do nível da lista atual.
      const siblingKind: ListKind = tag === "ol" ? "ordered" : "bullet";
      handleList(child, siblingKind, level + 1, marks, blocks);
      continue;
    }
    if (tag !== "li") continue;

    // Acha as listas aninhadas descendentes do <li> — diretas (forma
    // canônica) ou dentro de outro container (`<div>` etc; `<p>` nunca
    // aninha `<ul>` porque o parser HTML fecha o `<p>` antes). Só pega as
    // "de fora para dentro": uma lista aninhada dentro de outra lista já
    // encontrada não conta de novo aqui — ela é tratada recursivamente
    // quando a lista externa for percorrida.
    const nestedLists = topLevelListDescendants(child);

    // Clona o <li> e remove as listas aninhadas correspondentes do clone
    // antes de extrair o delta inline — sem isso, o texto do item filho
    // vaza para dentro do item pai (ex.: "B1" + "B2" viram "B1B2" quando a
    // lista aninhada está dentro de um <div> em vez de direta no <li>).
    const clone = child.cloneNode(true) as Element;
    for (const l of topLevelListDescendants(clone)) l.remove();
    const delta = inlineDeltaFromNodes(Array.from(clone.childNodes), marks);

    const attrs: BlockAttrs = { listKind: kind, listLevel: clampLevel(level) };
    const align = readAlign(child);
    if (align) attrs.align = align;
    blocks.push(makeBlock("listItem", delta, attrs));
    for (const nested of nestedLists) {
      const nestedKind: ListKind = nested.tagName.toLowerCase() === "ol" ? "ordered" : "bullet";
      handleList(nested, nestedKind, level + 1, marks, blocks);
    }
  }
}

/** `<ul>/<ol>` descendentes de `root` que não estão, por sua vez, dentro de
 *  outro `<ul>/<ol>` descendente de `root` — ou seja, o nível mais externo
 *  de listas aninhadas dentro de `root`, não importa quantos containers
 *  (`<div>`, `<p>`...) estejam no meio. Não atravessa fronteira de tabela:
 *  uma lista dentro de uma `<td>`/`<th>` de uma `<table>` que por sua vez
 *  esteja dentro de `root` pertence à célula, não ao `<li>` que contém a
 *  tabela — não é "promovida" a listItem irmão (edge case raro, tabela
 *  dentro de item de lista; ver `handleTable`, que não é chamado a partir
 *  daqui, então o conteúdo da tabela continua achatado como antes). */
function topLevelListDescendants(root: Element): Element[] {
  const all = Array.from(root.querySelectorAll("ul, ol"));
  return all.filter((el) => {
    let p = el.parentElement;
    while (p && p !== root) {
      const t = p.tagName.toLowerCase();
      if (t === "ul" || t === "ol" || t === "table" || t === "td" || t === "th") return false;
      p = p.parentElement;
    }
    return true;
  });
}

/** `<blockquote>` — se tiver filhos de bloco (ex.: `<p>` internos), cada um
 *  vira seu próprio bloco `blockquote`; senão, um único bloco a partir do
 *  conteúdo inline. */
function handleBlockquote(el: Element, marks: MarkAttrs, blocks: SerializedBlock[]): void {
  if (!hasBlockDescendant(el)) {
    const attrs: BlockAttrs = {};
    const align = readAlign(el);
    if (align) attrs.align = align;
    const delta = inlineDeltaFromNodes(Array.from(el.childNodes), marks);
    blocks.push(makeBlock("blockquote", delta, attrs));
    return;
  }
  const nested: SerializedBlock[] = [];
  walkBlockLevel(el, marks, nested);
  for (const b of nested) {
    blocks.push(b.type === "paragraph" ? { ...b, type: "blockquote" } : b);
  }
}

/** Tabelas ficam de fora do modelo: o texto de cada célula sobrevive como
 *  parágrafo(s), em ordem de leitura (linha a linha, célula a célula). Nunca
 *  descarta texto — só a estrutura de grade é perdida, de propósito. */
function handleTable(table: Element, marks: MarkAttrs, blocks: SerializedBlock[]): void {
  for (const row of directRows(table)) {
    const cells = Array.from(row.children).filter((c) =>
      ["td", "th"].includes(c.tagName.toLowerCase()),
    );
    for (const cell of cells) {
      const cellBlocks: SerializedBlock[] = [];
      walkBlockLevel(cell, marks, cellBlocks);
      for (const b of cellBlocks) {
        const attrs: BlockAttrs = {};
        if (b.attrs.align) attrs.align = b.attrs.align;
        blocks.push(makeBlock("paragraph", b.delta, attrs));
      }
    }
  }
}

function directRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "tr") {
      rows.push(child);
    } else if (tag === "tbody" || tag === "thead" || tag === "tfoot") {
      for (const r of Array.from(child.children)) {
        if (r.tagName.toLowerCase() === "tr") rows.push(r);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Word: `mso-list` (sem <ul>/<ol>/<li> reais)
// ---------------------------------------------------------------------------

/**
 * `mso-list:l0 level2 lfo1` → nível 1 (level é 1-based no Word).
 *
 * Isso sozinho não basta: o Word pode usar duas listas mso-list *separadas*
 * para pai e filho (`l0`/`lfo1` vs `l1`/`lfo2`) e marcar as duas como
 * `level1` — a profundidade real então só aparece no `margin-left` do
 * parágrafo, não no `levelN`. Por isso o nível final é o MAIOR entre o que
 * vem do `levelN` e o que vem da indentação (`nivelPelaMargem`): nenhum dos
 * dois caminhos é descartado, porque cada um cobre um caso que o outro não
 * cobre (levelN real sem margin-left; margin-left real com level1 repetido).
 */
function parseWordListLevel(styleAttr: string): number | null {
  const m = /mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(styleAttr);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  const fromLevelN = Number.isFinite(n) ? Math.max(0, n - 1) : 0;
  const fromMargin = wordListLevelFromMarginLeft(marginLeftPt(styleAttr));
  return clampLevel(Math.max(fromLevelN, fromMargin));
}

/** `margin-left` do parágrafo, convertido para pt. Aceita `pt`/`cm`/`in`/`px`;
 *  ausente, `auto`, negativo ou não-parseável conta como 0 (nunca reduz o
 *  nível abaixo do que `levelN` já indicava). Ignora `text-indent` de
 *  propósito — é o recuo pendente do marcador (`-18pt` típico), não a
 *  profundidade do item. */
function marginLeftPt(styleAttr: string): number {
  const raw = parseStyle(styleAttr)["margin-left"];
  if (!raw) return 0;
  const m = /^(-?[\d.]+)\s*(pt|cm|in|px)$/i.exec(raw.trim());
  if (!m) return 0;
  const val = Number.parseFloat(m[1]);
  if (!Number.isFinite(val) || val < 0) return 0;
  switch (m[2].toLowerCase()) {
    case "pt":
      return val;
    case "cm":
      return val * 28.3465;
    case "in":
      return val * 72;
    case "px":
      return val * 0.75;
    default:
      return 0;
  }
}

/** 36pt (0,5") é o passo padrão de indentação de lista do Word: primeiro
 *  nível de recuo (36pt) é nível 0, cada 36pt adicional soma 1 nível. */
function wordListLevelFromMarginLeft(pt: number): number {
  if (pt <= 0) return 0;
  return Math.max(0, Math.round(pt / 36) - 1);
}

/** Acha o span `mso-list:Ignore` que embrulha o marcador (número/símbolo +
 *  o espaço de tabulação até o texto real). */
function findWordListMarker(el: Element): Element | null {
  const all = el.querySelectorAll("*");
  for (const e of Array.from(all)) {
    const style = (e.getAttribute("style") ?? "").toLowerCase().replace(/\s+/g, "");
    if (style.includes("mso-list:ignore")) return e;
  }
  return null;
}

/** Marcador com dígito/letra seguido de `.`/`)` → ordered; símbolo (Symbol/
 *  Wingdings ou glifo não alfanumérico) → bullet. */
function detectWordListKind(markerEl: Element): ListKind {
  const all = [markerEl, ...Array.from(markerEl.querySelectorAll("*"))];
  for (const e of all) {
    const style = (e.getAttribute("style") ?? "").toLowerCase();
    if (style.includes("symbol") || style.includes("wingdings")) return "bullet";
  }
  const text = (markerEl.textContent ?? "").replace(/ /g, " ").trim();
  if (/^[0-9]+[.)]/.test(text)) return "ordered";
  if (/^[a-zA-Z][.)]/.test(text)) return "ordered";
  return "bullet";
}

// ---------------------------------------------------------------------------
// Walker inline (marcas + texto)
// ---------------------------------------------------------------------------

function inlineDeltaFromNodes(nodes: ChildNode[], marks: MarkAttrs): DeltaOp[] {
  const ops: DeltaOp[] = [];
  for (const n of nodes) walkInlineNode(n, marks, ops);
  return trimEdgeWhitespace(collapseRepeatedSpaces(mergeAdjacentOps(ops)));
}

/** Runs de espaço adjacentes em nós de texto distintos (ex.: "antes " + <img>
 *  removida + " depois") colapsam pra um único espaço quando as marcas batem
 *  e por isso já viraram um único op em `mergeAdjacentOps`. */
function collapseRepeatedSpaces(ops: DeltaOp[]): DeltaOp[] {
  return ops.map((op) =>
    typeof op.insert === "string" ? { ...op, insert: op.insert.replace(/ {2,}/g, " ") } : op,
  );
}

function walkInlineNode(node: ChildNode, marks: MarkAttrs, ops: DeltaOp[]): void {
  if (node.nodeType === Node.COMMENT_NODE) return;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent ?? "");
    if (text.length > 0) pushOp(ops, text, marks);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (IGNORED_TAGS.has(tag) || isNamespacedTag(tag)) return;
  if (tag === "img") return; // imagens ignoradas neste caminho.
  if (tag === "br") {
    ops.push({ insert: "\n" });
    return;
  }

  const styleAttr = (el.getAttribute("style") ?? "").toLowerCase().replace(/\s+/g, "");
  if (styleAttr.includes("mso-list:ignore")) return; // marcador de lista do Word.

  let nextMarks = applyTagMarks(tag, marks);
  nextMarks = applyStyleMarks(el.getAttribute("style"), nextMarks);
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href) nextMarks = { ...nextMarks, link: { href } };
  }

  for (const child of Array.from(el.childNodes)) walkInlineNode(child, nextMarks, ops);
}

/** Negrito/itálico/sublinhado/tachado por NOME da tag. `style` explícito
 *  (aplicado depois, em `applyStyleMarks`) tem prioridade e pode cancelar. */
function applyTagMarks(tag: string, marks: MarkAttrs): MarkAttrs {
  switch (tag) {
    case "b":
    case "strong":
      return { ...marks, bold: true };
    case "i":
    case "em":
      return { ...marks, italic: true };
    case "u":
      return { ...marks, underline: true };
    case "s":
    case "strike":
    case "del":
      return { ...marks, strike: true };
    default:
      return marks;
  }
}

function parseStyle(styleAttr: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!styleAttr) return out;
  for (const decl of styleAttr.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (prop) out[prop] = val;
  }
  return out;
}

/**
 * Aplica overrides de `style` inline por cima das marcas herdadas/de tag.
 * A regra central: `font-weight`/`font-style`/`text-decoration` explícitos no
 * style VENCEM o nome da tag — é o que impede o wrapper `<b style="font-
 * weight:normal">` do Google Docs de deixar o documento inteiro em negrito.
 *
 * `fontFamily` é intencionalmente NUNCA lida daqui — descartada sempre, junto
 * com `w:rFonts` no import-docx, pelo mesmo motivo (Arial-only). `fontSize` É
 * lida e normalizada para `pt` via `parseFontSizePt` — ver o comentário no
 * topo do arquivo.
 */
function applyStyleMarks(styleAttr: string | null, marks: MarkAttrs): MarkAttrs {
  const decls = parseStyle(styleAttr);
  if (Object.keys(decls).length === 0) return marks;
  const next: MarkAttrs = { ...marks };

  if ("font-weight" in decls) {
    const v = decls["font-weight"].toLowerCase();
    if (v === "bold" || /^[5-9]00$/.test(v)) next.bold = true;
    else if (v === "normal" || /^[1-4]00$/.test(v)) delete next.bold;
  }

  if ("font-style" in decls) {
    const v = decls["font-style"].toLowerCase();
    if (v === "italic" || v === "oblique") next.italic = true;
    else if (v === "normal") delete next.italic;
  }

  const deco = decls["text-decoration-line"] ?? decls["text-decoration"];
  if (deco !== undefined) {
    const v = deco.toLowerCase();
    delete next.underline;
    delete next.strike;
    if (v.includes("underline")) next.underline = true;
    if (v.includes("line-through")) next.strike = true;
  }

  if ("color" in decls) {
    const css = normalizeCssColor(decls.color);
    if (css && !isBlack(css)) next.color = css;
    else delete next.color;
  }

  const bg = decls["background-color"] ?? decls.background;
  if (bg !== undefined) {
    const css = normalizeCssColor(bg);
    if (css && css !== "#ffffff") next.highlight = css;
    else delete next.highlight;
  }

  if ("font-size" in decls) {
    const pt = parseFontSizePt(decls["font-size"]);
    // Só troca quando dá para resolver. Quando NÃO dá (em/%/larger/... ou
    // valor absurdo), o local não sobrescreve — mantém o que já veio herdado
    // do ancestral em vez de apagar um tamanho que já tínhamos resolvido
    // corretamente. Não é o mesmo padrão de `color`/`highlight` (que apagam
    // no valor não resolvível): lá um valor ausente/errado é positivamente
    // "sem cor"; aqui um `em`/`%` não resolvível não é "sem tamanho", é
    // "tamanho relativo que não sabemos calcular" — silenciar é melhor que
    // apagar informação que já tínhamos.
    if (pt != null) next.fontSize = formatFontSizePt(pt);
  }

  return next;
}

/** `font-size` do CSS → pt, ou `undefined` quando a unidade depende do
 *  contexto de herança do documento de origem (que não temos) ou o valor é
 *  absurdo. `px`/`in` convertem para pt; `pt` passa direto; `em`/`rem`/`%`/
 *  palavras-chave relativas (`larger`/`smaller`) e `medium`/`small`/`large`
 *  (que também dependem do tamanho herdado) são ignorados de propósito — ver
 *  o comentário no topo do arquivo. */
function parseFontSizePt(raw: string): number | undefined {
  const v = raw.trim().toLowerCase();
  const m = /^(-?[\d.]+)\s*(pt|px|in)$/.exec(v);
  if (!m) return undefined;
  const num = Number.parseFloat(m[1]);
  if (!Number.isFinite(num)) return undefined;
  let pt: number;
  switch (m[2]) {
    case "pt":
      pt = num;
      break;
    case "px":
      pt = num * 0.75;
      break;
    case "in":
      pt = num * 72;
      break;
    default:
      return undefined;
  }
  // O bound usa o valor JÁ ARREDONDADO pra uma casa decimal — é isso que vai
  // pro `formatFontSizePt`. Sem isso, algo como `0.04pt` passa no `pt > 0`
  // aqui mas arredonda pra `"0pt"` lá na frente, violando a regra de "≤0 não
  // emite" por trás do arredondamento em vez de antes dele.
  const rounded = Math.round(pt * 10) / 10;
  if (rounded <= 0 || rounded > 200) return undefined;
  return rounded;
}

/** No máximo uma casa decimal, sem zero à toa: `37.5pt`, `11pt` — nunca
 *  `37.50pt` nem `11.0pt`. */
function formatFontSizePt(pt: number): string {
  const rounded = Math.round(pt * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${str}pt`;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
  purple: "#800080",
};

/** CSS color (hex/rgb(a)/nomeado) → hex normalizado, ou `undefined` quando
 *  transparente/inválido/palavra-chave que não representa cor (inherit...). */
function normalizeCssColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === "transparent" || v === "none" || v === "inherit" || v === "initial") return undefined;
  if (v.startsWith("#")) {
    let hex = v.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : undefined;
  }
  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((s) => s.trim());
    if (parts.length < 3) return undefined;
    const alpha = parts[3] !== undefined ? Number.parseFloat(parts[3]) : 1;
    if (alpha === 0) return undefined;
    const toHex = (n: string) => {
      const num = Math.max(0, Math.min(255, Number.parseInt(n, 10) || 0));
      return num.toString(16).padStart(2, "0");
    };
    return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
  }
  return NAMED_COLORS[v];
}

function isBlack(hex: string): boolean {
  return hex.toLowerCase() === "#000000";
}

function readAlign(el: Element): AlignValue | undefined {
  const style = parseStyle(el.getAttribute("style"));
  const v = style["text-align"];
  if (!v) return undefined;
  switch (v.toLowerCase()) {
    case "left":
    case "start":
      return "left";
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_LIST_LEVEL, Math.trunc(n)));
}

// ---------------------------------------------------------------------------
// Delta helpers
// ---------------------------------------------------------------------------

function pushOp(ops: DeltaOp[], text: string, marks: MarkAttrs): void {
  const hasMarks = Object.keys(marks).length > 0;
  ops.push(hasMarks ? { insert: text, attributes: { ...marks } } : { insert: text });
}

/** HTML colapsa espaço/tab/quebra-de-linha ASCII em um único espaço; `&nbsp;`
 *  (já decodificado pelo DOMParser em U+00A0) é preservado literalmente — NÃO
 *  vira espaço normal (I2). "Nome:&nbsp;&nbsp;…&nbsp;Turma:" (a linha mais
 *  comum de uma prova) e os spans `mso-tab-count` do Word (corridas de
 *  `&nbsp;`) dependem disso: colapsar U+00A0 pra espaço ASCII destrói o
 *  espaçamento intencional do cabeçalho. As regexes de colapso
 *  (`collapseRepeatedSpaces`) e trim (`trimEdgeWhitespace`) abaixo são
 *  ASCII-only de propósito — `/ {2,}/` e `/[ \t\r\n]+/` — então o nbsp passa
 *  por elas intacto. */
function normalizeWhitespace(raw: string): string {
  return raw.replace(/[ \t\r\n]+/g, " ");
}

/** Remove espaço em branco nas bordas do bloco — HTML não renderiza
 *  espaço/quebra de linha logo após abrir ou logo antes de fechar um bloco. */
function trimEdgeWhitespace(ops: DeltaOp[]): DeltaOp[] {
  let out = ops;
  if (out.length > 0 && typeof out[0].insert === "string") {
    const trimmed = out[0].insert.replace(/^ +/, "");
    if (trimmed.length === 0) out = out.slice(1);
    else if (trimmed !== out[0].insert) out = [{ ...out[0], insert: trimmed }, ...out.slice(1)];
  }
  if (out.length > 0 && typeof out[out.length - 1].insert === "string") {
    const last = out[out.length - 1];
    const trimmed = (last.insert as string).replace(/ +$/, "");
    if (trimmed.length === 0) out = out.slice(0, -1);
    else if (trimmed !== last.insert) out = [...out.slice(0, -1), { ...last, insert: trimmed }];
  }
  return out;
}

function mergeAdjacentOps(ops: DeltaOp[]): DeltaOp[] {
  const out: DeltaOp[] = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (
      prev &&
      typeof prev.insert === "string" &&
      typeof op.insert === "string" &&
      sameMarks(prev.attributes, op.attributes)
    ) {
      prev.insert = prev.insert + op.insert;
      continue;
    }
    out.push({ ...op });
  }
  return out;
}

function sameMarks(a: MarkAttrs | undefined, b: MarkAttrs | undefined): boolean {
  const ak = a ? Object.keys(a).sort() : [];
  const bk = b ? Object.keys(b).sort() : [];
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    const av = (a as Record<string, unknown>)[ak[i]];
    const bv = (b as Record<string, unknown>)[bk[i]];
    if (typeof av === "object" && av !== null && typeof bv === "object" && bv !== null) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

function deltaToText(delta: DeltaOp[]): string {
  let s = "";
  for (const op of delta) if (typeof op.insert === "string") s += op.insert;
  return s;
}

function makeBlock(type: BlockType, delta: DeltaOp[], attrs: BlockAttrs): SerializedBlock {
  return { type, text: deltaToText(delta), delta, attrs };
}
