import type { BlockAttrs, BlockType } from "./types";

interface BlockSpec {
  type: BlockType;
  defaultAttrs: BlockAttrs;
}

export const BLOCK_SPECS: Record<BlockType, BlockSpec> = {
  paragraph: {
    type: "paragraph",
    defaultAttrs: {},
  },
  heading: {
    type: "heading",
    defaultAttrs: { level: 1 },
  },
  blockquote: {
    type: "blockquote",
    defaultAttrs: {},
  },
  codeBlock: {
    type: "codeBlock",
    defaultAttrs: {},
  },
  listItem: {
    type: "listItem",
    defaultAttrs: { listKind: "bullet", listLevel: 0 },
  },
  table: {
    type: "table",
    defaultAttrs: { rows: 1, cols: 1 },
  },
};

export function isKnownBlockType(t: string): t is BlockType {
  return t in BLOCK_SPECS;
}

export function defaultAttrsFor(type: BlockType): BlockAttrs {
  return { ...BLOCK_SPECS[type].defaultAttrs };
}
