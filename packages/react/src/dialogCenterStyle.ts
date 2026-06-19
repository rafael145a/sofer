import type { CSSProperties } from "react";

/**
 * Inline centering for the editor's native `<dialog showModal()>` modals
 * (link / caption / page-config). The package ships no CSS, so it can't rely on
 * the consumer keeping the UA `dialog { margin: auto }` centering intact — some
 * apps (Tailwind/HeroUI resets, custom `dialog { margin: 0 }`) override it and
 * the modal then opens in the top-left corner. `position: fixed` + translate is
 * reset-proof; `maxHeight`/`overflow` keep a tall dialog from spilling
 * off-screen when translated.
 */
export const DIALOG_CENTER_STYLE: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  margin: 0,
  maxHeight: "90vh",
  overflow: "auto",
};
