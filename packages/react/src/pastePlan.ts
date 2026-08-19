import type { ClipboardSlice } from "@sofereditor/core";
import { SOFER_MIME } from "@sofereditor/core";
import { htmlToSlice } from "./htmlToSlice";

/**
 * O que fazer com uma colagem, decidido só a partir do clipboard.
 *
 * Vive separado do handler para que a ORDEM dos ramos seja testável sem montar
 * o editor inteiro. A ordem já regrediu uma vez em produção (ver `planPaste`).
 */
export type PastePlan =
  /** Slice do próprio editor (cópia interna). */
  | { kind: "sofer"; slice: ClipboardSlice }
  /** HTML externo (Word, Google Docs, navegador) com conteúdo aproveitável. */
  | { kind: "html"; slice: ClipboardSlice }
  /** Arquivos de imagem do sistema operacional. */
  | { kind: "images"; files: File[] }
  /** Texto puro; `text` nunca é vazio. */
  | { kind: "text"; text: string }
  /** Nada aproveitável — o handler não deve nem chamar preventDefault. */
  | { kind: "none" };

/**
 * Decide o ramo da colagem.
 *
 * **A ordem é o ponto deste módulo.** HTML vem ANTES de arquivos de imagem: ao
 * copiar TEXTO, o Word coloca no clipboard o HTML completo E um PNG com o
 * trecho renderizado. Medido num caso real (2026-08-19): `types` =
 * `["text/plain","text/html","text/rtf","Files"]`, HTML de 40.517 bytes e
 * `image.png` de 7.392 bytes. Com arquivos na frente, o texto do professor era
 * colado como FIGURA e a formatação nunca era lida. O Google Docs não manda
 * arquivo — por isso só o Word sofria.
 *
 * Inverter é seguro porque `htmlToSlice` ignora imagens e devolve `null` quando
 * não sobra conteúdo: colar uma imagem (do Word, de um site ou do Finder) cai
 * no ramo de arquivos exatamente como antes.
 */
export function planPaste(cd: DataTransfer): PastePlan {
  // 1) Slice do próprio editor — sempre vence, é a representação mais fiel.
  const raw = cd.getData(SOFER_MIME);
  if (raw) {
    try {
      const slice = JSON.parse(raw) as ClipboardSlice;
      if (slice && Array.isArray(slice.blocks)) return { kind: "sofer", slice };
    } catch {
      // JSON corrompido — segue para os ramos externos.
    }
  }

  // 2) HTML externo, ANTES dos arquivos. Ver o comentário acima.
  const html = cd.getData("text/html");
  if (html) {
    const slice = htmlToSlice(html);
    if (slice) return { kind: "html", slice };
  }

  // 3) Arquivos de imagem.
  const files = Array.from(cd.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length > 0) return { kind: "images", files };

  // 4) Texto puro.
  const text = cd.getData("text/plain");
  if (text.length > 0) return { kind: "text", text };

  return { kind: "none" };
}
