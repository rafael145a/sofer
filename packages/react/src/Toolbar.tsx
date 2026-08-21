import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useEditorContext } from "./EditorContext";
import { ANSWER_LINE_MAX, isFormulaEmbed, TABLE_BORDER_COLOR } from "@sofereditor/core";
import type {
  AlignValue,
  AnswerLineSpacing,
  BlockType,
  DirValue,
  ImageLayout,
  MarkName,
  TableBorderPreset,
} from "@sofereditor/core";

// School standard: Arial only. The dropdown is kept (instead of removed) so
// that the surrounding font-size / color UI stays balanced and future font
// additions are a one-liner.
const FONT_FAMILIES = ["Arial"];
const FONT_SIZES = ["8pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "24pt", "32pt", "48pt"];

interface BlockOption {
  value: string;
  label: string;
  type: BlockType;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

const BLOCK_OPTIONS: BlockOption[] = [
  { value: "paragraph", label: "Parágrafo", type: "paragraph" },
  { value: "h1", label: "Título 1", type: "heading", level: 1 },
  { value: "h2", label: "Título 2", type: "heading", level: 2 },
  { value: "h3", label: "Título 3", type: "heading", level: 3 },
  { value: "h4", label: "Título 4", type: "heading", level: 4 },
  { value: "h5", label: "Título 5", type: "heading", level: 5 },
  { value: "h6", label: "Título 6", type: "heading", level: 6 },
  { value: "blockquote", label: "Citação", type: "blockquote" },
  { value: "codeBlock", label: "Código", type: "codeBlock" },
];

const ALIGN_OPTIONS: { value: AlignValue; label: string; title: string }[] = [
  { value: "left", label: "⇤", title: "Alinhar à esquerda" },
  { value: "center", label: "≡", title: "Centralizar" },
  { value: "right", label: "⇥", title: "Alinhar à direita" },
  { value: "justify", label: "☰", title: "Justificar" },
];

const IMAGE_ALIGN_VALUES = new Set<AlignValue>(["left", "center", "right"]);

/**
 * Controles nativos que PRECISAM receber o `mousedown` para abrir seu
 * dropdown/picker. Prevenir o mousedown num `<select>` impede o dropdown de
 * abrir — foi exatamente assim que o seletor de bordas da tabela nasceu morto.
 *
 * A regra vivia duplicada em três handlers com três listas diferentes; fica
 * aqui numa fonte só para não voltar a divergir.
 */
const NATIVE_CONTROL_TAGS = new Set(["SELECT", "INPUT", "OPTION"]);

export function isNativeControl(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && NATIVE_CONTROL_TAGS.has(el.tagName);
}

/**
 * Alvos dentro de um popover que mantêm o próprio `mousedown`. Superconjunto de
 * `isNativeControl` mais `BUTTON` — o resto é fundo de popover, onde o
 * `preventDefault` protege a seleção do editor.
 */
export function keepsOwnMouseDown(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (NATIVE_CONTROL_TAGS.has(el.tagName) || el.tagName === "BUTTON");
}

const IMAGE_LAYOUT_OPTIONS: { value: ImageLayout; label: string; title: string }[] = [
  { value: "inline", label: "↔", title: "Inline (no fluxo do texto)" },
  { value: "wrap-left", label: "◧", title: "Texto contorna à direita" },
  { value: "wrap-right", label: "◨", title: "Texto contorna à esquerda" },
  { value: "behind", label: "▢↓", title: "Atrás do texto" },
  { value: "front", label: "▢↑", title: "Na frente do texto" },
];

export interface ToolbarProps {
  className?: string;
}

export function Toolbar({ className }: ToolbarProps): JSX.Element {
  const editor = useEditorContext();
  const {
    isMarkActive,
    getActiveMarks,
    toggleMark,
    setMark,
    removeMark,
    getBlockType,
    getBlockAttr,
    setBlockType,
    setBlockAttr,
    setAlign,
    getAlign,
    isListActive,
    toggleList,
    indentList,
    dedentList,
  } = editor;
  const active = getActiveMarks();
  const blockType = getBlockType();
  const blockLevel = getBlockAttr("level");
  const blockAlign = getAlign();
  const blockDir = getBlockAttr("dir");

  // Preserve contenteditable focus when clicking the toolbar background or buttons,
  // BUT let native form controls (select/input) receive mousedown normally so their
  // dropdowns/pickers can open.
  const stop = (e: MouseEvent) => {
    if (isNativeControl(e.target)) return;
    e.preventDefault();
  };

  const onToggle = (name: MarkName) => (e: MouseEvent) => {
    e.preventDefault();
    toggleMark(name);
  };

  const onColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    setMark("color", e.target.value);
  };

  const onHighlightChange = (e: ChangeEvent<HTMLInputElement>) => {
    setMark("highlight", e.target.value);
  };

  const onFontFamilyChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === "") removeMark("fontFamily");
    else setMark("fontFamily", v);
  };

  const onFontSizeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === "") removeMark("fontSize");
    else setMark("fontSize", v);
  };

  const onBlockChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const opt = BLOCK_OPTIONS.find((o) => o.value === e.target.value);
    if (!opt) return;
    setBlockType(opt.type, opt.level !== undefined ? { level: opt.level } : undefined);
  };

  const onAlign = (value: AlignValue) => (e: MouseEvent) => {
    e.preventDefault();
    // When an image embed is selected, the three image-friendly alignments
    // (left/center/right) target the embed itself; otherwise fall through to
    // the block-level align attribute (which also handles "justify").
    const selectedEmbed = editor.getSelectedEmbed();
    if (selectedEmbed && IMAGE_ALIGN_VALUES.has(value)) {
      editor.setImageAttrs(
        selectedEmbed.blockIndex,
        selectedEmbed.offset,
        { align: value as "left" | "center" | "right" },
        selectedEmbed.cellIndex,
      );
      return;
    }
    setAlign(value);
  };

  const onInsertImageClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      imageInputRef.current?.click();
    },
    [],
  );
  const onImageInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void editor.insertImageFromFile(file);
      e.target.value = "";
    },
    [editor],
  );
  const imageInputRef = useRef<HTMLInputElement>(null);

  const onToggleDir = (e: MouseEvent) => {
    e.preventDefault();
    const next: DirValue = blockDir === "rtl" ? "ltr" : "rtl";
    setBlockAttr("dir", next);
  };

  const linkActive = isMarkActive("link");
  const onLinkClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const currentHref =
        active.link && typeof active.link === "object" && "href" in active.link
          ? (active.link.href as string)
          : "";
      void editor.requestLink(currentHref).then((href) => {
        if (href === null) return;
        if (href === "") removeMark("link");
        else setMark("link", { href });
      });
    },
    [active.link, editor, removeMark, setMark],
  );

  const colorValue = typeof active.color === "string" ? active.color : "#000000";
  // Amarelo clássico de marca-texto como padrão do picker quando nada está marcado.
  const highlightValue = typeof active.highlight === "string" ? active.highlight : "#fff176";
  const fontFamilyValue = typeof active.fontFamily === "string" ? active.fontFamily : "";
  const fontSizeValue = typeof active.fontSize === "string" ? active.fontSize : "";
  const blockValue = blockSelectValue(blockType, blockLevel);

  // The image layout group is only visible when an image embed is selected.
  // We read it fresh every render so the visibility tracks selection changes.
  const selectedEmbed = editor.getSelectedEmbed();
  const currentImageLayout: ImageLayout = selectedEmbed
    ? (selectedEmbed.embed.layout ?? "inline")
    : "inline";

  const onImageLayoutClick = (layout: ImageLayout) => (e: MouseEvent) => {
    e.preventDefault();
    const sel = editor.getSelectedEmbed();
    if (!sel) return;
    // Reset position offsets when switching modes; the previous values would
    // refer to a different coordinate system (margins vs. left/top).
    const reset =
      layout !== (sel.embed.layout ?? "inline")
        ? { offsetX: 0, offsetY: 0 }
        : {};
    editor.setImageAttrs(
      sel.blockIndex,
      sel.offset,
      { layout, ...reset },
      sel.cellIndex,
    );
  };

  return (
    <div
      className={className ?? "ed-toolbar"}
      role="toolbar"
      aria-label="Editor toolbar"
      onMouseDown={stop}
    >
      <Group>
        <select
          className="ed-toolbar-select"
          value={blockValue}
          onChange={onBlockChange}
          onMouseDown={stop}
          aria-label="Tipo de bloco"
        >
          {blockValue === "" && <option value="">— (misto)</option>}
          {BLOCK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Group>

      <Group>
        <MarkButton title="Negrito (⌘B)" pressed={isMarkActive("bold")} onClick={onToggle("bold")}>
          <strong>B</strong>
        </MarkButton>
        <MarkButton title="Itálico (⌘I)" pressed={isMarkActive("italic")} onClick={onToggle("italic")}>
          <em>I</em>
        </MarkButton>
        <MarkButton title="Sublinhado (⌘U)" pressed={isMarkActive("underline")} onClick={onToggle("underline")}>
          <u>U</u>
        </MarkButton>
        <MarkButton title="Tachado (⌘⇧X)" pressed={isMarkActive("strike")} onClick={onToggle("strike")}>
          <s>S</s>
        </MarkButton>
      </Group>

      <Group>
        <label className="ed-toolbar-label">
          <span className="ed-toolbar-swatch" aria-hidden style={{ background: colorValue }} />
          <input type="color" value={colorValue} onChange={onColorChange} onMouseDown={stop} aria-label="Cor do texto" />
        </label>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Remover cor"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            removeMark("color");
          }}
        >
          ⌫
        </button>
        <label className="ed-toolbar-label" title="Marca-texto">
          <span
            className="ed-toolbar-swatch ed-toolbar-swatch--highlight"
            aria-hidden
            style={{ background: highlightValue }}
          />
          <input
            type="color"
            value={highlightValue}
            onChange={onHighlightChange}
            onMouseDown={stop}
            aria-label="Marca-texto"
          />
        </label>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Remover marca-texto"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            removeMark("highlight");
          }}
        >
          ⌫
        </button>
      </Group>

      <Group>
        <select
          className="ed-toolbar-select"
          value={fontFamilyValue}
          onChange={onFontFamilyChange}
          onMouseDown={stop}
          aria-label="Família da fonte"
        >
          <option value="">Fonte…</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select
          className="ed-toolbar-select"
          value={fontSizeValue}
          onChange={onFontSizeChange}
          onMouseDown={stop}
          aria-label="Tamanho da fonte"
        >
          <option value="">Tamanho…</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Group>

      <Group>
        {ALIGN_OPTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            className="ed-toolbar-btn"
            title={a.title}
            aria-pressed={blockAlign === a.value}
            onMouseDown={stop}
            onClick={onAlign(a.value)}
          >
            {a.label}
          </button>
        ))}
      </Group>

      <Group>
        <button
          type="button"
          className="ed-toolbar-btn"
          aria-pressed={blockDir === "rtl"}
          title={blockDir === "rtl" ? "Mudar para LTR" : "Mudar para RTL (hebraico)"}
          onMouseDown={stop}
          onClick={onToggleDir}
        >
          {blockDir === "rtl" ? "RTL" : "LTR"}
        </button>
      </Group>

      <Group>
        <button
          type="button"
          className="ed-toolbar-btn"
          aria-pressed={isListActive("bullet")}
          title="Lista com marcadores (⌘⇧8)"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            toggleList("bullet");
          }}
        >
          •
        </button>
        <button
          type="button"
          className="ed-toolbar-btn"
          aria-pressed={isListActive("ordered")}
          title="Lista numerada (⌘⇧7)"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            toggleList("ordered");
          }}
        >
          1.
        </button>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Diminuir recuo (⇧Tab)"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            dedentList();
          }}
        >
          ⇤
        </button>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Aumentar recuo (Tab)"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            indentList();
          }}
        >
          ⇥
        </button>
      </Group>

      <Group>
        <button
          type="button"
          className="ed-toolbar-btn"
          aria-pressed={linkActive}
          title={linkActive ? "Remover link (⌘K)" : "Adicionar link (⌘K)"}
          onMouseDown={stop}
          onClick={onLinkClick}
        >
          🔗
        </button>
      </Group>

      <Group>
        <TableMenu />
        <AnswerLinesMenu />
      </Group>

      <Group>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Inserir imagem"
          onMouseDown={stop}
          onClick={onInsertImageClick}
        >
          🖼
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onImageInputChange}
        />
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Inserir fórmula"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            // `insertFormula` retornada (não disparada solta) para cair na
            // MESMA cadeia: um só `.catch` cobre tanto `requestFormula`
            // quanto `insertFormula`. Nenhuma das duas deveria rejeitar hoje
            // (`insertFormula` já protege o import dinâmico com try/catch),
            // mas sem este `.catch` uma rejeição inesperada vira unhandled
            // rejection — ruído em qualquer monitoramento de erro.
            void editor
              .requestFormula()
              .then((r) => (r ? editor.insertFormula(r.latex, r.display) : undefined))
              .catch((err) => {
                console.error("Falha ao inserir fórmula:", err);
              });
          }}
        >
          √x
        </button>
      </Group>

      {selectedEmbed && (
        <Group>
          {IMAGE_LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="ed-toolbar-btn"
              title={opt.title}
              aria-pressed={currentImageLayout === opt.value}
              onMouseDown={stop}
              onClick={onImageLayoutClick(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          {isFormulaEmbed(selectedEmbed.embed) ? (
            <button
              type="button"
              className="ed-toolbar-btn"
              title="Editar fórmula"
              onMouseDown={stop}
              onClick={(e) => {
                e.preventDefault();
                // NÃO é a mesma checagem "morta" de antes: o narrowing de
                // `isFormulaEmbed` no ternário (linha acima) não atravessa a
                // fronteira deste closure — `onClick` é uma função separada,
                // e dentro dela `selectedEmbed.embed.formula` volta a ser
                // `FormulaMeta | undefined` pro TS (`tsc --noEmit` reprova
                // sem este re-check; testado). Revalidar aqui é barato e
                // idempotente — nada muda entre o render e o clique.
                if (!isFormulaEmbed(selectedEmbed.embed)) return;
                const f = selectedEmbed.embed.formula;
                // A restauração da seleção do embed através do round-trip do
                // modal (bug #6) mora dentro de `insertFormula`
                // (`useEditor.ts`) — é a única com o `await` no meio, então é
                // a única que consegue segurar a seleção através do gap.
                void editor.requestFormula(f.latex, f.display).then((r) => {
                  if (!r) return;
                  void editor.insertFormula(r.latex, r.display);
                });
              }}
            >
              Editar fórmula
            </button>
          ) : (
            <button
              type="button"
              className="ed-toolbar-btn"
              title="Legenda da imagem"
              aria-pressed={!!selectedEmbed.embed.caption}
              onMouseDown={stop}
              onClick={(e) => {
                e.preventDefault();
                const initialCaption = selectedEmbed.embed.caption ?? "";
                const initialAlign = selectedEmbed.embed.captionAlign ?? "center";
                void editor.requestImageCaption(initialCaption, initialAlign).then((result) => {
                  if (result === null) return; // cancelled
                  const empty = result.caption.length === 0;
                  editor.setImageAttrs(
                    selectedEmbed.blockIndex,
                    selectedEmbed.offset,
                    {
                      caption: empty ? undefined : result.caption,
                      captionAlign: empty ? undefined : result.align,
                    },
                    selectedEmbed.cellIndex,
                  );
                });
              }}
            >
              Legenda
            </button>
          )}
        </Group>
      )}

      <Group>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Configurar página (tamanho, margens)"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            void editor.requestPageConfig();
          }}
        >
          ⚙
        </button>
      </Group>
    </div>
  );
}

// ---------- Table menu ----------

/**
 * Linhas de resposta: parágrafos pautados para o aluno escrever.
 *
 * Um botão em vez da digitação de underlines porque a régua precisa acompanhar
 * a margem — uma fileira de `_` quebra ao mudar tamanho de página ou fonte.
 */
function AnswerLinesMenu(): JSX.Element {
  const editor = useEditorContext();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(5);
  const [spacing, setSpacing] = useState<AnswerLineSpacing>(1.5);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const clamped = Math.max(1, Math.min(ANSWER_LINE_MAX, Math.trunc(count) || 1));

  return (
    <div ref={rootRef} className="ed-toolbar-tablemenu">
      <button
        type="button"
        className="ed-toolbar-btn"
        title="Linhas de resposta"
        aria-pressed={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        ☰
      </button>
      {open && (
        <div
          className="ed-table-popover ed-answerlines-popover"
          role="menu"
          onMouseDown={(e) => {
            if (!keepsOwnMouseDown(e.target)) e.preventDefault();
          }}
        >
          <label className="ed-toolbar-label">
            Quantidade
            <input
              type="number"
              min={1}
              max={ANSWER_LINE_MAX}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              aria-label="Quantidade de linhas"
            />
          </label>
          <label className="ed-toolbar-label">
            Entrelinha
            <select
              value={String(spacing)}
              onChange={(e) => setSpacing(Number(e.target.value) as AnswerLineSpacing)}
              aria-label="Entrelinha"
            >
              <option value="1">Simples</option>
              <option value="1.5">1,5</option>
              <option value="2">Duplo</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              editor.insertAnswerLines(clamped, spacing);
            }}
          >
            Inserir {clamped} linha{clamped > 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
}

function TableMenu(): JSX.Element {
  const editor = useEditorContext();
  const inTable = editor.isInTable();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="ed-toolbar-tablemenu">
      <button
        type="button"
        className="ed-toolbar-btn"
        title="Tabela"
        aria-pressed={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        ▦
      </button>
      {open && (
        <div
          className="ed-table-popover"
          role="menu"
          onMouseDown={(e) => {
            // Do not let mousedown clear the editor selection.
            if (!keepsOwnMouseDown(e.target)) e.preventDefault();
          }}
        >
          <TableSizePicker
            onPick={(rows, cols) => {
              setOpen(false);
              editor.insertTable(rows, cols);
            }}
          />
          {inTable && (
            <div className="ed-table-actions">
              <hr />
              <button type="button" onClick={() => { setOpen(false); editor.insertRowAbove(); }}>
                Inserir linha acima
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.insertRowBelow(); }}>
                Inserir linha abaixo
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.insertColumnLeft(); }}>
                Inserir coluna à esquerda
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.insertColumnRight(); }}>
                Inserir coluna à direita
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.deleteCurrentRow(); }}>
                Excluir linha
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.deleteCurrentColumn(); }}>
                Excluir coluna
              </button>
              <hr />
              {editor.hasTableRectSelection() && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); editor.mergeSelection(); }}
                >
                  Mesclar células selecionadas
                </button>
              )}
              <button type="button" onClick={() => { setOpen(false); editor.mergeRight(); }}>
                Mesclar com célula à direita
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.mergeDown(); }}>
                Mesclar com célula abaixo
              </button>
              <button type="button" onClick={() => { setOpen(false); editor.splitCell(); }}>
                Dividir células mescladas
              </button>
              <hr />
              <label className="ed-toolbar-label ed-table-bgcolor">
                <span
                  className="ed-toolbar-swatch"
                  aria-hidden
                  style={{ background: editor.getCellBackground() ?? "#ffffff" }}
                />
                Cor de fundo da célula
                <input
                  type="color"
                  value={editor.getCellBackground() ?? "#ffffff"}
                  onChange={(e) => editor.setCellBackground(e.target.value)}
                  aria-label="Cor de fundo da célula"
                />
              </label>
              <button type="button" onClick={() => { setOpen(false); editor.setCellBackground(null); }}>
                Remover cor de fundo
              </button>
              <hr />
              <label className="ed-toolbar-label">
                Bordas
                <select
                  value={editor.getTableBorderPreset()}
                  onChange={(e) =>
                    editor.setTableBorderPreset(e.target.value as TableBorderPreset)
                  }
                  aria-label="Bordas da tabela"
                >
                  <option value="all">Todas</option>
                  <option value="outer">Só externas</option>
                  <option value="horizontal">Só horizontais</option>
                  <option value="vertical">Só verticais</option>
                  <option value="none">Nenhuma</option>
                </select>
              </label>
              <label className="ed-toolbar-label ed-table-bgcolor">
                <span
                  className="ed-toolbar-swatch"
                  aria-hidden
                  style={{ background: editor.getTableBorderColor() ?? TABLE_BORDER_COLOR }}
                />
                Cor da borda
                <input
                  type="color"
                  value={editor.getTableBorderColor() ?? TABLE_BORDER_COLOR}
                  onChange={(e) => editor.setTableBorderColor(e.target.value)}
                  aria-label="Cor da borda"
                />
              </label>
              <button
                type="button"
                onClick={() => { setOpen(false); editor.setTableBorderColor(null); }}
              >
                Restaurar cor padrão
              </button>
              <hr />
              <button
                type="button"
                className="ed-table-delete"
                onClick={() => { setOpen(false); editor.deleteTable(); }}
              >
                Excluir tabela
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PICKER_MAX_ROWS = 8;
const PICKER_MAX_COLS = 10;

interface TableSizePickerProps {
  onPick: (rows: number, cols: number) => void;
}

function TableSizePicker({ onPick }: TableSizePickerProps): JSX.Element {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const label = hover ? `${hover.r + 1} × ${hover.c + 1}` : "Inserir tabela";
  return (
    <div className="ed-table-picker">
      <div className="ed-table-picker-label">{label}</div>
      <div
        className="ed-table-picker-grid"
        style={{
          gridTemplateColumns: `repeat(${PICKER_MAX_COLS}, 18px)`,
          gridTemplateRows: `repeat(${PICKER_MAX_ROWS}, 18px)`,
        }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: PICKER_MAX_ROWS }, (_, r) =>
          Array.from({ length: PICKER_MAX_COLS }, (_, c) => {
            const filled = hover != null && r <= hover.r && c <= hover.c;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                className={`ed-table-picker-cell${filled ? " filled" : ""}`}
                onMouseEnter={() => setHover({ r, c })}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  onPick(r + 1, c + 1);
                }}
                aria-label={`${r + 1} × ${c + 1}`}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

function blockSelectValue(
  type: BlockType | "mixed",
  level: unknown,
): string {
  if (type === "mixed") return "";
  if (type === "heading") {
    if (typeof level === "number" && level >= 1 && level <= 6) return `h${level}`;
    return "h1";
  }
  return type;
}

function Group({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ed-toolbar-group">{children}</div>;
}

interface MarkButtonProps {
  title: string;
  pressed: boolean;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
}

function MarkButton({ title, pressed, onClick, children }: MarkButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="ed-toolbar-btn"
      aria-pressed={pressed}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
