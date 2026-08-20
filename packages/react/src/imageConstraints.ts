/**
 * Max display width (CSS px) when inserting an image, no matter the source
 * (drag/drop, file picker, `insertImageFromFile`, or an embed parsed from
 * pasted HTML in `htmlToSlice`). Matches the A4 content area, so an image
 * never overflows the page margin. Larger sources are scaled down keeping
 * aspect ratio.
 *
 * Shared constant so every insertion path clamps the same way — without it,
 * an image pasted from HTML (which carries its own declared width/height)
 * could overflow while the exact same image dropped as a file would be
 * clamped, a visible asymmetry between two paths that should behave
 * identically.
 */
export const MAX_INSERT_WIDTH = 600;
