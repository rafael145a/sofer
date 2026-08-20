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
}

export function EditorProvider({ editor, children }: EditorProviderProps): JSX.Element {
  return (
    <EditorContext.Provider value={editor}>
      {children}
      <LinkDialog />
      <PageConfigDialog />
      <ImageCaptionDialog />
      <FormulaDialog />
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
