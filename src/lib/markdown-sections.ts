/** Split only actual level-two headings, never headings inside fenced examples. */
export function splitMarkdown(markdown: string): { title: string; body: string }[] {
  const blocks: { title: string; body: string }[] = [{ title: '', body: '' }];
  let fence = '';
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = '';
    }
    const heading = !fence && line.match(/^##\s+(.+?)\s*#*\s*$/);
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
