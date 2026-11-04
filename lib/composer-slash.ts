export interface ComposerSlashQuery {
  start: number;
  end: number;
  query: string;
  inline: boolean;
}

/** Match the slash token at a collapsed caret, without treating URLs or paths as commands. */
export function extractComposerSlashQuery(text: string, cursor = text.length, selectionEnd = cursor): ComposerSlashQuery | null {
  if (cursor !== selectionEnd || text.trimStart().startsWith("!")) return null;
  const before = text.slice(0, cursor);
  // A space/newline is the usual boundary. Chinese prose also permits typing
  // the slash directly after a character, without adding an artificial space.
  const match = /(^|[\s\u3400-\u9fff，。！？；：、（）【】《》“”‘’])\/([^\s/\\]*)$/.exec(before);
  if (!match) return null;
  const start = cursor - match[2].length - 1;
  let wordStart = start;
  while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) wordStart--;
  const precedingWord = text.slice(wordStart, start);
  if (/[\/\\]/.test(precedingWord)) return null;
  const tail = /^[^\s/\\]*/.exec(text.slice(cursor))?.[0] ?? "";
  const token = match[2] + tail;
  if (text[cursor + tail.length] === "/" || text[cursor + tail.length] === "\\") return null;
  if (token.includes(":") && !token.toLowerCase().startsWith("skill:")) return null;
  return { start, end: cursor + tail.length, query: match[2].toLowerCase(), inline: text.slice(0, start).trim().length > 0 };
}

export function completeComposerSlash(text: string, token: ComposerSlashQuery, command: { name: string; source: string }): { text: string; cursor: number } | null {
  const directive = `/${command.name} `;
  if (token.inline) {
    if (command.source !== "skill") return null;
    // pi expands a skill only at the start of a prompt. Move the selected
    // directive there in the editor so sending, queuing and draft restore all
    // keep using the existing SDK path, with the complete request as its args.
    const next = directive + text.slice(0, token.start) + text.slice(token.end);
    return { text: next, cursor: directive.length + token.start };
  }
  return { text: text.slice(0, token.start) + directive + text.slice(token.end), cursor: token.start + directive.length };
}
