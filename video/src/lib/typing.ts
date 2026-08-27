/**
 * Frame-driven typewriter. Returns the prefix of `text` that should be visible at `frame`,
 * given a start frame and how many frames each character takes.
 *
 * A plain function of `frame` rather than a stateful effect — Remotion renders frames out of
 * order and in parallel, so anything that accumulates over time would desync.
 */
export const typed = (
  text: string,
  frame: number,
  startFrame: number,
  framesPerChar: number,
): string => {
  const elapsed = frame - startFrame;
  if (elapsed <= 0) {
    return "";
  }
  return text.slice(0, Math.floor(elapsed / framesPerChar));
};

/** True while a typewriter is mid-word, so a caret can blink only where text is landing. */
export const isTyping = (
  text: string,
  frame: number,
  startFrame: number,
  framesPerChar: number,
): boolean => {
  const elapsed = frame - startFrame;
  return elapsed > 0 && elapsed / framesPerChar < text.length;
};
