import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import type { FormulaRender } from "@sofereditor/math";
import type { MathfieldElement } from "mathlive";
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
  const [abaAtiva, setAbaAtiva] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (formulaRequest) {
      setLatex(formulaRequest.initialLatex);
      setDisplay(formulaRequest.initialDisplay);
      setAbaAtiva(0);
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => inputRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
  }, [formulaRequest]);

  // O renderer chega por import dinâmico quando o modal abre. Fica em ref, não
  // em state: trocá-lo não precisa re-renderizar, quem re-renderiza é o preview.
  const rendererRef = useRef<((l: string, d: boolean) => FormulaRender) | null>(null);
  // Construtor do <math-field>. Ref e não state: quem re-renderiza é o campo,
  // montado imperativamente na Task 2.
  const mathfieldCtorRef = useRef<typeof MathfieldElement | null>(null);
  const [preview, setPreview] = useState<FormulaRender | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Separado de `preview` de propósito: `preview` é limpo pelo efeito de
  // render toda vez que `latex`/`display` mudam (abaixo), então se o erro de
  // carregamento morasse lá ele sumiria assim que o professor digitasse
  // qualquer coisa — com o renderer ainda ausente e o motivo do "Carregando…"
  // eterno escondido de novo.
  const [erroCarregando, setErroCarregando] = useState<string | null>(null);

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
        // Chunk falhou ao carregar — o caso comum é um deploy que trocou o
        // hash dos assets enquanto a prova estava aberta na aba. Sem isto,
        // `carregando` ficava travado em `true` para sempre: modal aberto,
        // "Carregando o renderizador…" eterno, botão Inserir desabilitado
        // sem nenhuma explicação e sem saída a não ser Cancelar.
        setCarregando(false);
        setErroCarregando(
          "Não foi possível carregar o editor de fórmulas. Recarregue a página e tente de novo.",
        );
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
              title={p.titulo ?? p.label}
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
          ) : erroCarregando ? (
            <span className="ed-formula-erro" role="alert">
              {erroCarregando}
            </span>
          ) : preview == null ? (
            <span className="ed-formula-vazio">O preview aparece aqui.</span>
          ) : preview.ok ? (
            <span
              className="ed-formula-preview-svg"
              // O LaTeX AQUI É entrada do usuário — quem digita é o professor.
              // `dangerouslySetInnerHTML` é aceitável mesmo assim por dois
              // motivos, não porque o SVG "não vem de fora":
              // 1. Superfície só de autor: quem escreve o LaTeX já pode
              //    editar o documento inteiro, então não há elevação de
              //    privilégio em conseguir injetar algo aqui.
              // 2. A config do TeX usada pelo renderer (`packages: ["base",
              //    "ams"]`, em @sofereditor/math) exclui a extensão `html`
              //    do MathJax — é essa extensão que produziria `\href` e
              //    outras tags perigosas no SVG de saída. Sem ela, o
              //    renderer não emite HTML/links a partir do LaTeX.
              // Se algum dia trocar para `AllPackages` (ou incluir `html`),
              // esta análise deixa de valer e o `dangerouslySetInnerHTML`
              // precisa ser revisto.
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
