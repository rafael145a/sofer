import type { ClipboardSlice } from "@sofereditor/core";
import { isImageEmbed, SOFER_MIME } from "@sofereditor/core";
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
  /**
   * HTML externo (Word, Google Docs, navegador) com conteúdo aproveitável.
   * `imagensAvulsas`, quando presente, são arquivos de imagem que vieram
   * junto no clipboard mas que o HTML não referenciava (ver o comentário
   * acima de `hasWordEmbeddedPicture`) — o handler insere o slice e depois
   * anexa essas imagens no final, para o professor arrastar até o lugar.
   */
  | { kind: "html"; slice: ClipboardSlice; imagensAvulsas?: File[] }
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
    if (slice) {
      // Word para Mac (medido 2026-08-20): copiar texto+imagem NÃO escreve a
      // imagem no HTML de jeito nenhum (nem VML, nem `data:`) — só existe o
      // arquivo solto em `cd.files`, sem marca de onde ela estava no texto.
      // Perder essa imagem em silêncio é pior que anexá-la fora do lugar
      // (decisão do usuário): quando o slice não tem embed nenhum (ver item
      // 1 — o Google Docs ESCREVE `<img data:>`, então esse caso não passa
      // por aqui) e há arquivo de imagem no clipboard, ela é anexada ao
      // final do trecho colado.
      //
      // Mas ISSO SÓ PODE disparar quando o Word realmente embutiu uma
      // figura: como documentado no comentário de `planPaste` acima, Word
      // também anexa um PNG "screenshot" do trecho copiado em toda colagem
      // de TEXTO PURO (sem imagem nenhuma) — o caso medido que motivou HTML
      // vir antes de arquivos. Sem um segundo sinal, TODA colagem de texto
      // formatado do Word ganharia uma imagem fantasma no final. O sinal:
      // `text/rtf` — Word codifica imagem embutida como grupo `\pict` no
      // RTF (parte do formato, não comportamento específico de versão); um
      // PNG que é só o rendering da seleção não deixa esse rastro no RTF.
      const files = Array.from(cd.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0 && !sliceHasImageEmbed(slice) && hasWordEmbeddedPicture(cd.getData("text/rtf"))) {
        return { kind: "html", slice, imagensAvulsas: files };
      }
      return { kind: "html", slice };
    }
  }

  // 3) Arquivos de imagem.
  const files = Array.from(cd.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length > 0) return { kind: "images", files };

  // 4) Texto puro.
  const text = cd.getData("text/plain");
  if (text.length > 0) return { kind: "text", text };

  return { kind: "none" };
}

/** Algum bloco do slice já carrega um embed de imagem (ex.: `<img data:>` do
 *  Google Docs, tratado em `htmlToSlice`). Usado para não duplicar a imagem
 *  quando o clipboard também trouxer um arquivo solto para o mesmo conteúdo. */
function sliceHasImageEmbed(slice: ClipboardSlice): boolean {
  return slice.blocks.some((b) => b.delta.some((op) => isImageEmbed(op.insert)));
}

/**
 * `true` quando o RTF do clipboard contém um grupo `\pict` — a forma padrão
 * (RTF 1.x, não específica de versão do Word) de embutir uma imagem inline no
 * texto. Distingue "o professor copiou uma figura de verdade" de "o Word
 * também anexou um PNG-screenshot do trecho copiado", que NÃO deixa esse
 * rastro no RTF — é só uma representação de conveniência pra apps que só
 * entendem imagem (colar texto do Word no Preview.app, por exemplo).
 *
 * Sem `text/rtf` no clipboard (navegador, Google Docs, Finder) devolve
 * `false` — sem esse sinal positivo, o padrão é NÃO anexar (perder uma
 * imagem de fora do Word é um caso já coberto por outro caminho; inventar uma
 * imagem fantasma em toda colagem de texto formatado do Word seria pior).
 */
function hasWordEmbeddedPicture(rtf: string): boolean {
  return /\\pict\b/.test(rtf);
}
