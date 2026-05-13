import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { useEditorContext } from "./EditorContext";

/**
 * Modal dialog for entering a link URL. Replaces the bare `window.prompt`
 * previously wired to Cmd+K and the toolbar link button. Renders only when
 * `editor.linkRequest` is set; consumes that state via `resolveLinkRequest`.
 *
 * Uses the native `<dialog>` element for focus trapping, ESC handling, and the
 * browser-provided backdrop.
 */
export function LinkDialog(): JSX.Element | null {
  const { linkRequest, resolveLinkRequest } = useEditorContext();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [href, setHref] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (linkRequest) {
      setHref(linkRequest.initialHref);
      if (!dialog.open) dialog.showModal();
      // Defer focus + select-all to after the dialog finishes opening.
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
  }, [linkRequest]);

  if (!linkRequest) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    resolveLinkRequest(href.trim());
  };

  const onRemove = () => {
    // Empty string signals "remove the link mark".
    resolveLinkRequest("");
  };

  const onCancel = () => {
    resolveLinkRequest(null);
  };

  return (
    <dialog
      ref={dialogRef}
      className="ed-link-dialog"
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={onSubmit} className="ed-link-dialog-form">
        <div className="ed-link-dialog-row">
          <label htmlFor="ed-link-href">URL</label>
          <input
            id="ed-link-href"
            ref={inputRef}
            type="url"
            inputMode="url"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="https://exemplo.com"
            autoComplete="off"
          />
        </div>
        <div className="ed-link-dialog-actions">
          {linkRequest.initialHref ? (
            <button type="button" onClick={onRemove} className="ed-link-dialog-remove">
              Remover link
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
