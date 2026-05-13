import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { useEditorContext } from "./EditorContext";
import type { CaptionAlign } from "./useEditor";

/**
 * Modal dialog for entering an image caption. Mirrors `LinkDialog` — driven by
 * `editor.imageCaptionRequest`. Empty input is treated as "remove caption".
 *
 * The only configurable property besides the text itself is the caption's
 * horizontal alignment (left / center / right). Word-style figure-caption
 * controls stop here intentionally — see `ImageEmbed.captionAlign`.
 */
export function ImageCaptionDialog(): JSX.Element | null {
  const { imageCaptionRequest, resolveImageCaptionRequest } = useEditorContext();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [align, setAlign] = useState<CaptionAlign>("center");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (imageCaptionRequest) {
      setCaption(imageCaptionRequest.initialCaption);
      setAlign(imageCaptionRequest.initialAlign);
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => {
        const input = inputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      });
    } else if (dialog.open) {
      dialog.close();
    }
  }, [imageCaptionRequest]);

  if (!imageCaptionRequest) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    resolveImageCaptionRequest({ caption, align });
  };
  const onRemove = () => resolveImageCaptionRequest({ caption: "", align });
  const onCancel = () => resolveImageCaptionRequest(null);

  return (
    <dialog
      ref={dialogRef}
      className="ed-caption-dialog ed-link-dialog"
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={onSubmit} className="ed-link-dialog-form">
        <div className="ed-link-dialog-row">
          <label htmlFor="ed-caption-input">Legenda</label>
          <input
            id="ed-caption-input"
            ref={inputRef}
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Ex.: Figura 1 — Mapa do Brasil"
            autoComplete="off"
          />
        </div>
        <div className="ed-link-dialog-row">
          <span>Alinhamento</span>
          <div className="ed-caption-align-group" role="radiogroup" aria-label="Alinhamento da legenda">
            {(["left", "center", "right"] as const).map((value) => (
              <label key={value} className="ed-caption-align-option">
                <input
                  type="radio"
                  name="caption-align"
                  value={value}
                  checked={align === value}
                  onChange={() => setAlign(value)}
                />
                {value === "left" ? "Esquerda" : value === "center" ? "Centro" : "Direita"}
              </label>
            ))}
          </div>
        </div>
        <div className="ed-link-dialog-actions">
          {imageCaptionRequest.initialCaption ? (
            <button type="button" onClick={onRemove} className="ed-link-dialog-remove">
              Remover legenda
            </button>
          ) : (
            <span />
          )}
          <div className="ed-link-dialog-confirm">
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className="ed-link-dialog-apply">
              Aplicar
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
