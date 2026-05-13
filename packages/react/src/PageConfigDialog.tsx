import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from "react";
import {
  MARGIN_PRESETS,
  PAGE_PRESETS,
  detectPreset,
  mmToPx,
  pxToMm,
  type PageSettings,
  type PagePreset,
} from "@editor/core";
import { useEditorContext } from "./EditorContext";

type MarginPreset = "normal" | "narrow" | "wide" | "custom";

/**
 * Modal dialog to configure page size and margins. Mirrors `LinkDialog` —
 * driven by `editor.pageConfigRequest`. On apply, writes via
 * `editor.setPageSettings`; on cancel, no write.
 */
export function PageConfigDialog(): JSX.Element | null {
  const { pageConfigRequest, resolvePageConfigRequest, setPageSettings } = useEditorContext();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Form state. Sizes are kept in mm for user-facing inputs; we convert to px
  // when applying. Width/height pair determines the size preset.
  const [sizePreset, setSizePreset] = useState<PagePreset>("a4");
  const [widthMm, setWidthMm] = useState(210);
  const [heightMm, setHeightMm] = useState(297);
  const [marginPreset, setMarginPreset] = useState<MarginPreset>("normal");
  const [marginTopMm, setMarginTopMm] = useState(25.4);
  const [marginBottomMm, setMarginBottomMm] = useState(25.4);
  const [marginLeftMm, setMarginLeftMm] = useState(25.4);
  const [marginRightMm, setMarginRightMm] = useState(25.4);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pageConfigRequest) {
      hydrateFromSettings(pageConfigRequest.initial, {
        setSizePreset,
        setWidthMm,
        setHeightMm,
        setMarginPreset,
        setMarginTopMm,
        setMarginBottomMm,
        setMarginLeftMm,
        setMarginRightMm,
      });
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pageConfigRequest]);

  // When the user picks a size preset, snap width/height back to the canonical
  // values. "custom" leaves the user free to edit.
  useEffect(() => {
    if (sizePreset === "custom") return;
    const p = PAGE_PRESETS[sizePreset];
    setWidthMm(roundMm(pxToMm(p.width)));
    setHeightMm(roundMm(pxToMm(p.height)));
  }, [sizePreset]);

  // When the user picks a margin preset, set all 4 margins to that value.
  useEffect(() => {
    if (marginPreset === "custom") return;
    const px = MARGIN_PRESETS[marginPreset];
    const mm = roundMm(pxToMm(px));
    setMarginTopMm(mm);
    setMarginBottomMm(mm);
    setMarginLeftMm(mm);
    setMarginRightMm(mm);
  }, [marginPreset]);

  const customWidth = sizePreset === "custom";

  // Live preview of the dimensions in px so the test/QA loop is easy to read.
  const previewPx = useMemo(
    () => ({
      width: Math.round(mmToPx(widthMm)),
      height: Math.round(mmToPx(heightMm)),
    }),
    [widthMm, heightMm],
  );

  if (!pageConfigRequest) return null;

  const onApply = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<PageSettings> = {
      width: mmToPx(widthMm),
      height: mmToPx(heightMm),
      marginTop: mmToPx(marginTopMm),
      marginBottom: mmToPx(marginBottomMm),
      marginLeft: mmToPx(marginLeftMm),
      marginRight: mmToPx(marginRightMm),
    };
    setPageSettings(next);
    resolvePageConfigRequest(true);
  };
  const onCancel = () => resolvePageConfigRequest(false);

  return (
    <dialog
      ref={dialogRef}
      className="ed-page-config-dialog"
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={onApply} className="ed-page-config-form">
        <h2>Configurar página</h2>

        <fieldset>
          <legend>Tamanho</legend>
          <div className="ed-page-config-row">
            <label>
              <input
                type="radio"
                name="size"
                checked={sizePreset === "a4"}
                onChange={() => setSizePreset("a4")}
              />{" "}
              A4 (210 × 297 mm)
            </label>
            <label>
              <input
                type="radio"
                name="size"
                checked={sizePreset === "letter"}
                onChange={() => setSizePreset("letter")}
              />{" "}
              Carta (216 × 279 mm)
            </label>
            <label>
              <input
                type="radio"
                name="size"
                checked={sizePreset === "oficio"}
                onChange={() => setSizePreset("oficio")}
              />{" "}
              Ofício (216 × 330 mm)
            </label>
            <label>
              <input
                type="radio"
                name="size"
                checked={sizePreset === "custom"}
                onChange={() => setSizePreset("custom")}
              />{" "}
              Personalizado
            </label>
          </div>
          <div className="ed-page-config-row">
            <label>
              Largura (mm){" "}
              <input
                type="number"
                step={0.1}
                min={50}
                max={1000}
                value={widthMm}
                onChange={(e) => setWidthMm(Number(e.target.value))}
                disabled={!customWidth}
              />
            </label>
            <label>
              Altura (mm){" "}
              <input
                type="number"
                step={0.1}
                min={50}
                max={1000}
                value={heightMm}
                onChange={(e) => setHeightMm(Number(e.target.value))}
                disabled={!customWidth}
              />
            </label>
            <span className="ed-page-config-preview">
              {previewPx.width} × {previewPx.height} px
            </span>
          </div>
        </fieldset>

        <fieldset>
          <legend>Margens</legend>
          <div className="ed-page-config-row">
            <label>
              <input
                type="radio"
                name="margin"
                checked={marginPreset === "normal"}
                onChange={() => setMarginPreset("normal")}
              />{" "}
              Normal (25,4 mm)
            </label>
            <label>
              <input
                type="radio"
                name="margin"
                checked={marginPreset === "narrow"}
                onChange={() => setMarginPreset("narrow")}
              />{" "}
              Estreita (12,7 mm)
            </label>
            <label>
              <input
                type="radio"
                name="margin"
                checked={marginPreset === "wide"}
                onChange={() => setMarginPreset("wide")}
              />{" "}
              Larga (50,8 mm)
            </label>
            <label>
              <input
                type="radio"
                name="margin"
                checked={marginPreset === "custom"}
                onChange={() => setMarginPreset("custom")}
              />{" "}
              Personalizada
            </label>
          </div>
          <div className="ed-page-config-row">
            <label>
              Topo{" "}
              <input
                type="number"
                step={0.1}
                min={0}
                max={200}
                value={marginTopMm}
                onChange={(e) => {
                  setMarginTopMm(Number(e.target.value));
                  setMarginPreset("custom");
                }}
              />
            </label>
            <label>
              Inferior{" "}
              <input
                type="number"
                step={0.1}
                min={0}
                max={200}
                value={marginBottomMm}
                onChange={(e) => {
                  setMarginBottomMm(Number(e.target.value));
                  setMarginPreset("custom");
                }}
              />
            </label>
            <label>
              Esquerda{" "}
              <input
                type="number"
                step={0.1}
                min={0}
                max={200}
                value={marginLeftMm}
                onChange={(e) => {
                  setMarginLeftMm(Number(e.target.value));
                  setMarginPreset("custom");
                }}
              />
            </label>
            <label>
              Direita{" "}
              <input
                type="number"
                step={0.1}
                min={0}
                max={200}
                value={marginRightMm}
                onChange={(e) => {
                  setMarginRightMm(Number(e.target.value));
                  setMarginPreset("custom");
                }}
              />
            </label>
          </div>
        </fieldset>

        <div className="ed-page-config-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="ed-page-config-apply">
            Aplicar
          </button>
        </div>
      </form>
    </dialog>
  );
}

function roundMm(mm: number): number {
  return Math.round(mm * 10) / 10;
}

function hydrateFromSettings(
  s: PageSettings,
  setters: {
    setSizePreset: (v: PagePreset) => void;
    setWidthMm: (v: number) => void;
    setHeightMm: (v: number) => void;
    setMarginPreset: (v: MarginPreset) => void;
    setMarginTopMm: (v: number) => void;
    setMarginBottomMm: (v: number) => void;
    setMarginLeftMm: (v: number) => void;
    setMarginRightMm: (v: number) => void;
  },
): void {
  const preset = detectPreset(s.width, s.height);
  setters.setSizePreset(preset);
  setters.setWidthMm(roundMm(pxToMm(s.width)));
  setters.setHeightMm(roundMm(pxToMm(s.height)));
  const top = roundMm(pxToMm(s.marginTop));
  const bottom = roundMm(pxToMm(s.marginBottom));
  const left = roundMm(pxToMm(s.marginLeft));
  const right = roundMm(pxToMm(s.marginRight));
  setters.setMarginTopMm(top);
  setters.setMarginBottomMm(bottom);
  setters.setMarginLeftMm(left);
  setters.setMarginRightMm(right);
  setters.setMarginPreset(detectMarginPreset(s));
}

function detectMarginPreset(s: PageSettings): MarginPreset {
  const TOL = 1; // px
  const allEqual =
    Math.abs(s.marginTop - s.marginBottom) <= TOL &&
    Math.abs(s.marginTop - s.marginLeft) <= TOL &&
    Math.abs(s.marginTop - s.marginRight) <= TOL;
  if (!allEqual) return "custom";
  for (const [name, px] of Object.entries(MARGIN_PRESETS) as Array<[keyof typeof MARGIN_PRESETS, number]>) {
    if (Math.abs(s.marginTop - px) <= TOL) return name as MarginPreset;
  }
  return "custom";
}
