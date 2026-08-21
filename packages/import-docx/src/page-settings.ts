import { detectPreset, mmToPx, type PageSettings } from "@sofereditor/core";
import { attr, findChild, type OoxmlNode } from "./parse-xml";
import { parseIntAttr } from "./units";

/**
 * 1 inch = 1440 twips = 25.4 mm. So 1 twip = 25.4/1440 mm.
 *
 * Page size lives in `<w:sectPr><w:pgSz w:w="..." w:h="..."/></w:sectPr>` and
 * margins in `<w:pgMar w:top="..." w:bottom="..." w:left="..." w:right="..."/>`,
 * all in twips. This is the inverse of `sectionPropertiesFor` in
 * `@sofereditor/export-docx`.
 */
const MM_PER_TWIP = 25.4 / 1440;

function twipsToPx(twips: number): number {
  return mmToPx(twips * MM_PER_TWIP);
}

export function sectPrToPageSettings(
  sectPr: OoxmlNode | undefined,
): PageSettings | undefined {
  if (!sectPr) return undefined;
  const pgSz = findChild(sectPr, "w:pgSz");
  const pgMar = findChild(sectPr, "w:pgMar");
  if (!pgSz && !pgMar) return undefined;

  const widthTwips = pgSz ? parseIntAttr(attr(pgSz, "w:w"), 0) : 0;
  const heightTwips = pgSz ? parseIntAttr(attr(pgSz, "w:h"), 0) : 0;
  const topTwips = pgMar ? parseIntAttr(attr(pgMar, "w:top"), 0) : 0;
  const bottomTwips = pgMar ? parseIntAttr(attr(pgMar, "w:bottom"), 0) : 0;
  const leftTwips = pgMar ? parseIntAttr(attr(pgMar, "w:left"), 0) : 0;
  const rightTwips = pgMar ? parseIntAttr(attr(pgMar, "w:right"), 0) : 0;

  if (widthTwips <= 0 && heightTwips <= 0 && topTwips <= 0 && leftTwips <= 0) {
    return undefined;
  }

  const width = widthTwips > 0 ? twipsToPx(widthTwips) : 794;
  const height = heightTwips > 0 ? twipsToPx(heightTwips) : 1123;
  const settings: PageSettings = {
    width,
    height,
    marginTop: twipsToPx(topTwips || 0),
    marginBottom: twipsToPx(bottomTwips || 0),
    marginLeft: twipsToPx(leftTwips || 0),
    marginRight: twipsToPx(rightTwips || 0),
  };
  settings.preset = detectPreset(settings.width, settings.height);
  return settings;
}

/**
 * Largura útil da página em twips, direto do `w:sectPr` — `pgSz.w` menos as
 * margens esquerda/direita, tudo em twips, sem passar por px/mm no meio.
 *
 * Usada para reconstruir `tableWidth` (percentual) a partir de `w:tblW`, que
 * também está em twips: dividir twip-contra-twip evita compor DUAS conversões
 * com arredondamento próprio (px→mm→twip na leitura da página E na leitura
 * da tabela) — a mesma fonte de erro documentada acima em `twipsToPx`.
 *
 * `undefined` quando o documento não declara `pgSz` — sem largura de página
 * não há largura útil para calcular `tableWidth` contra, então o import
 * deixa o atributo ausente (default 100) em vez de arriscar uma conta contra
 * um denominador inventado.
 */
export function larguraUtilTwipsDe(sectPr: OoxmlNode | undefined): number | undefined {
  if (!sectPr) return undefined;
  const pgSz = findChild(sectPr, "w:pgSz");
  if (!pgSz) return undefined;
  const width = parseIntAttr(attr(pgSz, "w:w"), 0);
  if (width <= 0) return undefined;
  const pgMar = findChild(sectPr, "w:pgMar");
  const left = pgMar ? parseIntAttr(attr(pgMar, "w:left"), 0) : 0;
  const right = pgMar ? parseIntAttr(attr(pgMar, "w:right"), 0) : 0;
  const util = width - left - right;
  return util > 0 ? util : undefined;
}
