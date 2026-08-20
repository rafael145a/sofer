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
  //
  // Tentativa abandonada (2026-08-20): tentamos anexar, no final do trecho
  // colado, o arquivo de imagem solto que o Word deixa em `cd.files` quando
  // o HTML não referencia nenhuma figura (nem `<img>`, nem VML, nem `data:`).
  // A ideia era usar o grupo `\pict` do RTF como sinal de que uma figura de
  // verdade tinha sido copiada, distinguindo isso do PNG "screenshot" que o
  // Word também anexa em TODA colagem de texto (ver o comentário acima).
  //
  // Verificado com clipboard real do Word para Mac — o discriminador não
  // existe. Duas colagens medidas no navegador:
  //   colagem 1 (SÓ TEXTO, sem figura):    \pict: 0  \shppict: false  PNG: 55.814 bytes  <img>: 0
  //   colagem 2 (TEXTO + FIGURA de verdade): \pict: 0  \shppict: false  PNG: 24.902 bytes  <img>: 0
  // Nenhuma das duas tem `\pict` no RTF, nenhuma tem `<img>` no HTML, as duas
  // trazem um PNG — e o tamanho não separa (a colagem só-texto rendeu um
  // arquivo MAIOR que a com figura). O PNG que o Word anexa é sempre uma
  // renderização da seleção, nunca a figura em si — não há sinal nenhum no
  // clipboard que distinga os dois casos.
  const files = Array.from(cd.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length > 0) return { kind: "images", files };

  // 4) Texto puro.
  const text = cd.getData("text/plain");
  if (text.length > 0) return { kind: "text", text };

  return { kind: "none" };
}
