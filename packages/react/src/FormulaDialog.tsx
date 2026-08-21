import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import type { FormulaRender } from "@sofereditor/math";
import type { MathfieldElement } from "mathlive";
import { useEditorContext } from "./EditorContext";
import { DIALOG_CENTER_STYLE } from "./dialogCenterStyle";
import { PALETA, paraMathlive, conteudoDoBotao } from "./formulaSnippet";
import { podeInserir, motivoBloqueio } from "./formulaGuarda";

/**
 * Caracteres que a tecla morta de circunflexo do teclado ABNT2 (o brasileiro)
 * produz quando o professor a pressiona e a próxima tecla não aceita acento —
 * `^` seguido de `2`, por exemplo.
 *
 * `U+02C6` é o circunflexo modificador, e `U+0302` o acento combinante. O
 * MathLive trata os dois como texto literal, então digitar "x", circunflexo,
 * "2" saía **`xˆ2`** — o acento impresso ao lado do x, e o 2 na linha de
 * baixo. Era o caminho mais natural do mundo para escrever "x ao quadrado"
 * numa prova, e o único que não funcionava.
 *
 * O `^` ASCII (U+005E) NÃO entra nesta lista: esse o MathLive já trata certo
 * sozinho. O `²` (U+00B2) também já vira `x^{2}` sem ajuda.
 */
const CIRCUNFLEXO_DE_TECLA_MORTA = new Set(["\u02C6", "\u0302"]);

/**
 * Modal de fórmula. Espelha `ImageCaptionDialog` — dirigido por
 * `editor.formulaRequest`.
 *
 * O preview usa o MESMO renderer que a inserção vai usar. Se o preview falha,
 * o botão de inserir fica desabilitado: nunca inserir um embed cujo render
 * falhou, senão entra no documento um <img> quebrado.
 */
export function FormulaDialog({
  fontsDirectory,
}: {
  fontsDirectory?: string;
}): JSX.Element | null {
  const { formulaRequest, resolveFormulaRequest } = useEditorContext();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
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
  // Renderer dos botões da paleta. Ref e não state pelo mesmo motivo do
  // `mathfieldCtorRef` acima: quem re-renderiza é o `setCarregando(false)`
  // do mesmo `.then()`.
  const markupRef = useRef<((latex: string) => string) | null>(null);
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
        markupRef.current = mathlive.convertLatexToMarkup;
        // São 240 KB de sons de tecla no pacote. Editor de prova não apita.
        // `soundsDirectory` e `fontsDirectory` são ESTÁTICOS na classe, não
        // opções por instância — daí ficarem aqui, uma vez por página, em
        // vez de na montagem imperativa do campo.
        mathlive.MathfieldElement.soundsDirectory = null;
        if (fontsDirectory) {
          mathlive.MathfieldElement.fontsDirectory = fontsDirectory;
        }
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

  // Precisa ser capture (`true` no addEventListener) e chegar antes do
  // "keyboard sink" interno do MathLive — medido: o `beforeinput` chega
  // cancelável no <math-field> antes de chegar no sink. Um `inlineShortcuts`
  // com a mesma chave NÃO funciona: o caractere de tecla morta não passa pelo
  // caminho de atalhos.
  const onCircunflexoMorto = useCallback((e: Event) => {
    const ev = e as InputEvent;
    if (!ev.data || !CIRCUNFLEXO_DE_TECLA_MORTA.has(ev.data)) return;
    ev.preventDefault();
    ev.stopPropagation();
    fieldRef.current?.insert("^{#?}", { focus: true });
  }, []);

  // Montagem imperativa do <math-field>, não JSX: o elemento não tem tipo em
  // `IntrinsicElements`, o React 18 põe atributo (não propriedade) em custom
  // element, e o construtor só existe depois do import dinâmico resolver —
  // o JSX teria que renderizar condicionalmente um elemento ainda indefinido.
  useEffect(() => {
    const Ctor = mathfieldCtorRef.current;
    const host = hostRef.current;
    if (!Ctor || !host || !formulaRequest) return;

    const mf = new Ctor();
    mf.className = "ed-formula-field";
    const onInput = () => setLatex(mf.getValue("latex"));
    mf.addEventListener("input", onInput);
    mf.addEventListener("beforeinput", onCircunflexoMorto, true);

    // MONTAR PRIMEIRO, CONFIGURAR DEPOIS — a ordem é o ponto, e custou uma
    // tela branca para descobrir.
    //
    // Boa parte dos acessores do MathfieldElement começa com
    // `if (!this._mathfield) throw new Error("Mathfield not mounted")`, e o
    // `_mathfield` só nasce no `connectedCallback`. O `inlineShortcuts` é o
    // pior deles: tem essa guarda no getter E no setter, então a linha
    // `{ ...mf.inlineShortcuts }` abaixo lançava duas vezes.
    //
    // Como isso roda dentro de um efeito do React, o erro não estraga só o
    // modal: derruba a árvore inteira. O professor clicava em "Inserir
    // fórmula" e o editor virava tela branca, com a prova aberta.
    //
    // Nenhum teste de unidade pega isto — o jsdom não roda o MathLive. Só
    // navegador de verdade.
    host.appendChild(mf);

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
      // Vírgula decimal. Em modo matemático a vírgula crua é átomo de
      // pontuação e ganha espaço DEPOIS de si: digitar "3,14" sai impresso
      // como "3, 14" (medido: 4.4ex contra 4.023ex do agrupado). A paleta
      // tem um botão `{,}`, mas ninguém clica num botão para uma tecla que
      // está no teclado — e decimal aparece em toda prova de matemática,
      // física e química.
      //
      // O `after: "digit"` é o que separa os dois usos da vírgula, e foi
      // verificado no navegador: "3,14" vira `3{,}14` e "f(x,y)" continua
      // `f\left(x,y\right)`, com a vírgula de lista intacta — que é o
      // comportamento certo, ali ela É pontuação.
      ",": { after: "digit", value: "{,}" },
    };
    mf.setValue(formulaRequest.initialLatex);
    // Sem esta linha, editar uma fórmula existente abre com o campo cheio e o
    // botão Inserir DESABILITADO: `latex` continuaria "" e o gate leria campo
    // vazio. Lê de volta do campo em vez de reusar `initialLatex` porque o
    // MathLive pode normalizar na entrada, e o estado tem que ser o que o
    // campo realmente tem.
    setLatex(mf.getValue("latex"));
    fieldRef.current = mf;
    queueMicrotask(() => mf.focus());

    return () => {
      mf.removeEventListener("input", onInput);
      mf.removeEventListener("beforeinput", onCircunflexoMorto, true);
      mf.remove();
      fieldRef.current = null;
    };
  }, [formulaRequest, carregando]);

  if (!formulaRequest) return null;

  const markup = markupRef.current;
  const motivo = motivoBloqueio(latex, preview);
  const podeSubmeter = podeInserir(latex, preview);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!podeSubmeter) return;
    resolveFormulaRequest({ latex, display });
  };
  const onCancel = () => resolveFormulaRequest(null);

  const onPaleta = (snippet: string) => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.insert(paraMathlive(snippet), { focus: true });
    setLatex(mf.getValue("latex"));
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
              aria-label={p.titulo ?? p.label}
              onClick={() => onPaleta(p.snippet)}
              // Markup vem do `convertLatexToMarkup` do MathLive sobre um
              // snippet ESTÁTICO da nossa PALETA — não é entrada de usuário.
              // `paraMarkup` (não `paraMathlive`, que é para o campo e usa
              // `#?` — inválido para este renderer) troca `{}` por `{□}`
              // só para o ícone: `^{}`/`_{}` crus saem VAZIOS deste
              // renderer (verificado, não deduzido — ver formulaSnippet.ts).
              {...conteudoDoBotao(markup, p.snippet, p.label)}
            />
          ))}
        </div>
        <div ref={hostRef} className="ed-formula-host" />
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
            <span className="ed-formula-vazio">Carregando o editor…</span>
          ) : erroCarregando ? (
            <span className="ed-formula-erro" role="alert">
              {erroCarregando}
            </span>
          ) : motivo ? (
            <span className="ed-formula-erro" role="alert">
              {motivo}
            </span>
          ) : null}
        </div>
        <div className="ed-formula-acoes">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={!podeSubmeter}>
            Inserir
          </button>
        </div>
      </form>
    </dialog>
  );
}
