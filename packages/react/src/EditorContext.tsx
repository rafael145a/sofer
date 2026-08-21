import { createContext, useContext, type JSX, type ReactNode } from "react";
import { LinkDialog } from "./LinkDialog";
import { PageConfigDialog } from "./PageConfigDialog";
import { ImageCaptionDialog } from "./ImageCaptionDialog";
import { FormulaDialog } from "./FormulaDialog";
import type { UseEditorResult } from "./useEditor";

const EditorContext = createContext<UseEditorResult | null>(null);

export interface EditorProviderProps {
  editor: UseEditorResult;
  children: ReactNode;
  /**
   * De onde servir as 20 fontes .woff2 do MathLive (296 KB). Sem elas o
   * campo desenha com fonte do sistema — feio e SILENCIOSO. O caminho muda
   * por app por causa do base path, então é o app que sabe.
   */
  mathliveFontsDirectory?: string;
}

export function EditorProvider({
  editor,
  children,
  mathliveFontsDirectory,
}: EditorProviderProps): JSX.Element {
  return (
    <EditorContext.Provider value={editor}>
      {children}
      <LinkDialog />
      <PageConfigDialog />
      <ImageCaptionDialog />
      <FormulaDialog fontsDirectory={mathliveFontsDirectory} />
    </EditorContext.Provider>
  );
}

export function useEditorContext(): UseEditorResult {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error("useEditorContext must be used inside an <EditorProvider>");
  }
  return ctx;
}
