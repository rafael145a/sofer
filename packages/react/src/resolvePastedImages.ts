import { isImageEmbed, type ClipboardSlice, type DeltaOp } from "@sofereditor/core";

/**
 * Alguma imagem do slice ainda está embutida como `data:` — candidata a subir
 * pro storage (`uploadImage`) antes de `insertSlice`. Usado pelo handler de
 * paste em `Editor.tsx` para decidir se vale a pena esperar por upload
 * (assíncrono) ou se pode inserir o slice na hora (o caso comum — colagem sem
 * imagem nenhuma).
 */
export function sliceHasDataImageEmbeds(slice: ClipboardSlice): boolean {
  return slice.blocks.some((b) =>
    b.delta.some((op) => isImageEmbed(op.insert) && op.insert.src.startsWith("data:image/")),
  );
}

/**
 * Troca cada embed de imagem com `src` `data:` pela URL devolvida por
 * `upload`, num slice novo (não muta `slice`).
 *
 * `htmlToSlice` é deliberadamente pura (ver o comentário lá) e só emite
 * `data:` — subir pro storage é responsabilidade de quem tem o contexto do
 * editor, não do parser de HTML. Uma imagem do Google Docs em base64 tem
 * ~340KB; gravar isso direto no Y.Doc incha o documento e fura o storage.
 *
 * `upload` ausente (sem `uploadImage` configurado — caso do playground)
 * devolve o slice inalterado, mesmo comportamento que `insertImageFromFile`
 * já tem hoje.
 *
 * Falha de upload de UMA imagem não aborta a colagem inteira: mantém o
 * `data:` daquela imagem específica e segue para as outras. Registra no
 * console — falha silenciosa em produção seria pior que o log.
 */
export async function resolvePastedImageUploads(
  slice: ClipboardSlice,
  upload: ((file: File) => Promise<string>) | undefined,
): Promise<ClipboardSlice> {
  if (!upload) return slice;
  const blocks = await Promise.all(
    slice.blocks.map(async (block) => {
      let changed = false;
      const delta: DeltaOp[] = await Promise.all(
        block.delta.map(async (op): Promise<DeltaOp> => {
          if (!isImageEmbed(op.insert) || !op.insert.src.startsWith("data:image/")) return op;
          try {
            const file = dataUrlToFile(op.insert.src);
            const newSrc = await upload(file);
            changed = true;
            return { ...op, insert: { ...op.insert, src: newSrc } };
          } catch (err) {
            console.error(
              "[sofereditor] falha ao subir imagem colada para o storage — mantendo a imagem embutida (data:) nesta colagem",
              err,
            );
            return op;
          }
        }),
      );
      return changed ? { ...block, delta } : block;
    }),
  );
  return { ...slice, blocks };
}

/** `data:<mime>;base64,<...>` → `File`, com nome/extensão derivados do MIME
 *  (não `.png` fixo — um jpeg do Google Docs enviado como `.png` é uma falha
 *  de upload plausível em APIs que validam extensão x content-type). */
export function dataUrlToFile(dataUrl: string): File {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]*)$/.exec(dataUrl);
  const mime = match?.[1]?.trim() || "image/png";
  const base64 = match?.[2] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `imagem-colada-${Date.now()}.${extensionForMime(mime)}`, { type: mime });
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.toLowerCase()] ?? "png";
}
