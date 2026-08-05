import { EditorDocument, type SerializedBlock, type SerializedDocument } from "@sofereditor/core";
import { readDocx, childrenOf, tagOf, findChild, type OoxmlNode } from "./parse-xml";
import { paragraphToBlock } from "./paragraphs";
import { tableToBlock } from "./tables";
import { NumberingResolver } from "./numbering";
import { sectPrToPageSettings } from "./page-settings";
import type { RunContext } from "./runs";

/**
 * Read a `.docx` (OOXML) Blob/ArrayBuffer/Uint8Array and produce a
 * `SerializedDocument` ready to feed `EditorDocument.fromJSON` (or
 * `loadFromJSON` on an existing instance).
 *
 * The mapping is the inverse of `@sofereditor/export-docx`. Round-trip is exact for
 * documents the editor produced; documents authored externally (Word, Google
 * Docs export) load with marks/lists/tables/images recognized and unsupported
 * features dropped silently.
 */
export async function docxBlobToDocument(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<SerializedDocument> {
  const file = await readDocx(input);
  const numbering = new NumberingResolver(file.numberingXml);
  const ctx: RunContext = {
    relationships: file.relationships,
    mediaBytes: file.mediaBytes,
  };

  const body = findBody(file.documentXml);
  if (!body) return { blocks: [{ type: "paragraph", text: "", delta: [], attrs: {} }] };

  const blocks: SerializedBlock[] = [];
  for (const child of childrenOf(body)) {
    const tag = tagOf(child);
    if (tag === "w:p") {
      blocks.push(paragraphToBlock(child, ctx, numbering));
    } else if (tag === "w:tbl") {
      blocks.push(tableToBlock(child, ctx));
    }
    // w:sectPr is parsed below (page settings); other body-level metadata ignored.
  }

  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", text: "", delta: [], attrs: {} });
  }

  pruneNonLeaderListStarts(blocks);

  const pageSettings = sectPrToPageSettings(findChild(body, "w:sectPr"));
  return pageSettings ? { blocks, pageSettings } : { blocks };
}

/**
 * O Word numera por INSTÂNCIA (`numId`): parágrafos comuns entre itens não
 * resetam a contagem. O editor numera por ADJACÊNCIA: o renderer agrupa
 * `listItem`s consecutivos do mesmo `listKind`/`listStyle`, e um `listStart`
 * em item de CONTINUAÇÃO quebra o grupo ali. O parse gravou o ordinal Word em
 * `listStart` de TODOS os itens ordenados; este pós-passe o mantém apenas nos
 * LÍDERES de grupo (primeiro item, item após bloco comum, ou após item de
 * kind/estilo diferente) — assim o editor renderiza exatamente os números do
 * Word ("3." depois de uma linha de resposta, "b." em subitens) sem fragmentar
 * os grupos.
 */
export function pruneNonLeaderListStarts(blocks: SerializedBlock[]): void {
  // Estado do grupo de adjacência corrente: estilo do líder e último ordinal
  // visto por nível (para exigir sequência contígua — duas listas Word
  // independentes coladas, "1,2,3" + "1,2", NÃO podem fundir num 1..5).
  let grupoAtivo = false;
  let grupoStyle: unknown;
  let ordinais: number[] = [];

  const resetGrupo = () => {
    grupoAtivo = false;
    grupoStyle = undefined;
    ordinais = [];
  };

  for (const block of blocks) {
    if (block.type !== "listItem") {
      resetGrupo();
      continue;
    }
    if ((block.attrs.listKind ?? "bullet") !== "ordered") {
      // Bullet entre ordenados: mantém o grupo do renderer? Não — kind
      // diferente quebra o grupo lá também.
      resetGrupo();
      continue;
    }
    const level = block.attrs.listLevel ?? 0;
    const ordinal = typeof block.attrs.listStart === "number" ? block.attrs.listStart : 1;

    const mesmoNivelSequencial = ordinais[level] != null && ordinal === ordinais[level] + 1;
    const entrandoEmNivelNovo = ordinais[level] == null && level > 0 && ordinal === 1;
    const continuaGrupo =
      grupoAtivo &&
      block.attrs.listStyle === grupoStyle &&
      (mesmoNivelSequencial || entrandoEmNivelNovo);

    if (continuaGrupo) {
      delete block.attrs.listStart;
    } else {
      // Este item lidera um grupo novo no renderer (listStart preservado).
      grupoAtivo = true;
      grupoStyle = block.attrs.listStyle;
      ordinais = [];
    }
    ordinais[level] = ordinal;
    ordinais.length = level + 1;
  }
}

/** Convenience: parse → instantiate a fresh `EditorDocument`. */
export async function docxBlobToEditorDocument(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<EditorDocument> {
  const serialized = await docxBlobToDocument(input);
  return EditorDocument.fromJSON(serialized);
}

function findBody(documentXml: OoxmlNode[]): OoxmlNode | undefined {
  for (const top of documentXml) {
    if (tagOf(top) === "w:document") {
      const body = findChild(top, "w:body");
      if (body) return body;
    }
  }
  return undefined;
}
