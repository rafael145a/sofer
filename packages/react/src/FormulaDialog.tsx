import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import type { FormulaRender } from "@sofereditor/math";
import { useEditorContext } from "./EditorContext";
import { DIALOG_CENTER_STYLE } from "./dialogCenterStyle";
import { PALETA, applySnippet } from "./formulaSnippet";

/**
 * Modal de fórmula. Espelha `ImageCaptionDialog` — dirigido por
 * `editor.formulaRequest`.
 *
 * O preview usa o MESMO renderer que a inserção vai usar. Se o preview falha,
 * o botão de inserir fica desabilitado: nunca inserir um embed cujo render
 * falhou, senão entra no documento um <img> quebrado.
 */
export function FormulaDialog(): JSX.Element | null {
  const { formulaRequest, resolveFormulaRequest } = useEditorContext();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [latex, setLatex] = useState("");
  const [display, setDisplay] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (formulaRequest) {
      setLatex(formulaRequest.initialLatex);
      setDisplay(formulaRequest.initialDisplay);
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => inputRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
  }, [formulaRequest]);

  // O renderer chega por import dinâmico quando o modal abre. Fica em ref, não
  // em state: trocá-lo não precisa re-renderizar, quem re-renderiza é o preview.
  const rendererRef = useRef<((l: string, d: boolean) => FormulaRender) | null>(null);
  const [preview, setPreview] = useState<FormulaRender | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!formulaRequest || rendererRef.current) return;
    setCarregando(true);
    // Import DINÂMICO: mantém o mathjax-full fora do bundle principal.
    void import("@sofereditor/math").then((m) => {
      rendererRef.current = m.renderLatexToSvg;
      setCarregando(false);
    });
  }, [formulaRequest]);

  // Sem debounce: o render é síncrono e leva menos de um milissegundo para as
  // fórmulas desta paleta, depois que o módulo já carregou.
  useEffect(() => {
    const render = rendererRef.current;
    if (!render || !latex.trim()) {
      setPreview(null);
      return;
    }
    setPreview(render(latex, display));
  }, [latex, display, carregando]);

  if (!formulaRequest) return null;

  const podeInserir = preview?.ok === true;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!podeInserir) return;
    resolveFormulaRequest({ latex, display });
  };
  const onCancel = () => resolveFormulaRequest(null);

  const onPaleta = (snippet: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? latex.length;
    const end = el?.selectionEnd ?? latex.length;
    const r = applySnippet(latex, start, end, snippet);
    setLatex(r.text);
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(r.cursor, r.cursor);
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="ed-formula-dialog ed-link-dialog"
      style={DIALOG_CENTER_STYLE}
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={onSubmit} className="ed-formula-form">
        <div className="ed-formula-paleta">
          {PALETA.map((p) => (
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
        <textarea
          ref={inputRef}
          className="ed-formula-input"
          rows={3}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          aria-label="Fórmula em LaTeX"
          placeholder="\frac{1}{2}"
        />
        <label className="ed-formula-display">
          <input
            type="checkbox"
            checked={display}
            onChange={(e) => setDisplay(e.target.checked)}
          />
          Fórmula em bloco (centralizada, limites acima e abaixo)
        </label>
        <div className="ed-formula-preview" aria-live="polite">
          {carregando ? (
            <span className="ed-formula-vazio">Carregando o renderizador…</span>
          ) : preview == null ? (
            <span className="ed-formula-vazio">O preview aparece aqui.</span>
          ) : preview.ok ? (
            <span
              className="ed-formula-preview-svg"
              // O SVG vem do nosso próprio renderer, não de entrada externa.
              dangerouslySetInnerHTML={{ __html: preview.svg }}
            />
          ) : (
            <span className="ed-formula-erro" role="alert">
              {preview.error}
            </span>
          )}
        </div>
        <div className="ed-formula-acoes">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={!podeInserir}>
            Inserir
          </button>
        </div>
      </form>
    </dialog>
  );
}
