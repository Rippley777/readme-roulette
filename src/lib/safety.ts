const excluded =
  /(^|\/)(node_modules|vendor|dist|build|\.git|coverage|\.next|target|__pycache__)(\/|$)|(?:\.lock|lock\.json|\.min\.js|\.map)$/i;
export function safePath(path: string) {
  return (
    !excluded.test(path) &&
    !/(^|\/)(\.env(?!\.(example|sample|template)$)[^/]*|[^/]*(?:credentials|secrets?|private[-_]?key)[^/]*|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx|crt|cer)$/i.test(
      path,
    )
  );
}
export function redact(content: string) {
  return content
    .replace(/-----BEGIN [\s\S]*?-----END [^\n]+-----/g, '[REDACTED]')
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED]',
    )
    .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/|postgres(?:ql)?:\/\/)([^\s/@]+:[^\s/@]+)@/g, '$1[REDACTED]@');
}
