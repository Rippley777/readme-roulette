import { Fragment } from 'react';
/** Lightweight Markdown syntax layer; the textarea remains the accessible input. */
export default function MarkdownSource({ text }: { text: string }) {
  let code = false;
  return (
    <pre className="syntax-highlight" aria-hidden="true">
      {text.split('\n').map((line, index) => {
        const fence = /^\s*```/.test(line);
        const className = fence
          ? 'syntax-fence'
          : code
            ? 'syntax-code'
            : /^#{1,6} /.test(line)
              ? 'syntax-heading'
              : /^\s*<!--/.test(line)
                ? 'syntax-comment'
                : undefined;
        if (fence) code = !code;
        return (
          <Fragment key={index}>
            <span className={className}>
              {className
                ? line
                : line.split(/(`[^`]+`|\*\*[^*]+\*\*|!?\[[^\]]*\]\([^)]+\))/g).map((part, i) => (
                    <span
                      key={i}
                      className={
                        part.startsWith('`')
                          ? 'syntax-inline'
                          : part.startsWith('**')
                            ? 'syntax-strong'
                            : /^!?\[/.test(part)
                              ? 'syntax-link'
                              : undefined
                      }
                    >
                      {part}
                    </span>
                  ))}
            </span>
            {'\n'}
          </Fragment>
        );
      })}
    </pre>
  );
}
