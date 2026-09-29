/** Track CommonMark fences, including longer fences containing shorter examples. */
export function markdownLines(markdown: string) {
  let fence: { marker: string; length: number } | undefined;
  return markdown.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const inCode = Boolean(fence || marker || /^(?: {4}|\t)/.test(line));
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    }
    return { line, inCode };
  });
}
/** Protect runnable examples, identifiers, links, tables and headings during prose edits. */
export function markdownSegments(markdown: string) {
  return markdownLines(markdown).flatMap(({ line, inCode }, index, lines) => {
    const suffix = index < lines.length - 1 ? '\n' : '';
    if (inCode || /^\s*(?:#{1,6} |\||<!--|-->)/.test(line))
      return [{ text: line + suffix, protected: true }];
    return (line + suffix)
      .split(/(`+[^`\n]*`+|!?\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s]+)/g)
      .filter(Boolean)
      .map((text) => ({ text, protected: /^`|^!?\[|^https?:\/\//.test(text) }));
  });
}
/** Split only actual level-two headings, never headings inside fenced examples. */
export function splitMarkdown(markdown: string): { title: string; body: string }[] {
  const blocks: { title: string; body: string }[] = [{ title: '', body: '' }];
  for (const { line, inCode } of markdownLines(markdown.replace(/\r\n/g, '\n'))) {
    const heading = !inCode && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (heading) blocks.push({ title: heading[1], body: '' });
    else blocks[blocks.length - 1].body += line + '\n';
  }
  return blocks.map((block) => ({ ...block, body: block.body.trim() }));
}
export function joinMarkdown(blocks: ReturnType<typeof splitMarkdown>) {
  return (
    blocks
      .map((b) => (b.title ? `## ${b.title}\n\n` : '') + b.body)
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
export function replaceSection(markdown: string, title: string, body: string | null) {
  const blocks = splitMarkdown(markdown),
    index = blocks.findIndex((b) => b.title === title);
  if (index >= 0) {
    if (body === null) blocks.splice(index, 1);
    else blocks[index].body = body;
  } else if (body !== null) blocks.push({ title, body });
  return joinMarkdown(blocks);
}
