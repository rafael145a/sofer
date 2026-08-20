import type { JSX, MouseEvent } from "react";
import type { TableBorderPreset } from "@sofereditor/core";

/**
 * Vocabulário do `w:tblBorders` do Word. Glifos de texto em vez de biblioteca
 * de ícones para manter o idioma do `Toolbar.tsx` (⇤ ≡ ⇥ ☰ • 🔗 ▦ 🖼 ⚙) e não
 * pendurar uma dependência de ícones num pacote publicado.
 *
 * `⊞` (U+229E) é o quadrado dividido em quatro — o ícone de bordas do Word e do
 * Docs. NÃO trocar por `▦`: é grade fina, e já é o glifo do botão de tabela.
 */
export const BORDER_PRESETS: readonly {
  key: TableBorderPreset;
  label: string;
  glyph: string;
}[] = [
  { key: "all", label: "Todas", glyph: "⊞" },
  { key: "outer", label: "Só externas", glyph: "□" },
  { key: "horizontal", label: "Só horizontais", glyph: "▤" },
  { key: "vertical", label: "Só verticais", glyph: "▥" },
  { key: "none", label: "Nenhuma", glyph: "⬚" },
];

/** Glifo do gatilho. Mesmo desenho do preset "all", como no Word. */
export const BORDER_MENU_GLYPH = "⊞";

export interface TableBorderPanelProps {
  preset: TableBorderPreset;
  /** Cor atual da linha, já resolvida (nunca `null`). */
  color: string;
  onPreset: (p: TableBorderPreset) => void;
  onColor: (c: string) => void;
  onResetColor: () => void;
}

/**
 * Conteúdo do painel de bordas: os cinco presets e a cor da linha.
 *
 * Puro de propósito — sem contexto do editor e sem estado. Quem hospeda decide
 * onde ele aparece e de onde vêm os valores; assim dá para testá-lo por render
 * estática, que é a única forma de teste disponível neste pacote.
 */
export function TableBorderPanel({
  preset,
  color,
  onPreset,
  onColor,
  onResetColor,
}: TableBorderPanelProps): JSX.Element {
  return (
    <div className="ed-border-panel">
      <div className="ed-border-presets">
        {BORDER_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="ed-border-preset"
            aria-pressed={preset === p.key}
            title={p.label}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              onPreset(p.key);
            }}
          >
            <span className="ed-border-glyph" aria-hidden>
              {p.glyph}
            </span>
            {p.label}
          </button>
        ))}
      </div>
      <hr />
      <label className="ed-toolbar-label ed-border-color">
        <span className="ed-toolbar-swatch" aria-hidden style={{ background: color }} />
        Cor da linha
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          aria-label="Cor da linha da borda"
        />
      </label>
      <button
        type="button"
        className="ed-border-reset"
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          onResetColor();
        }}
      >
        Padrão
      </button>
    </div>
  );
}
