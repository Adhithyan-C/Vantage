export function sanitizeRequestError(message: string): string {
  return message
    .replace(/\b(key|api_key|token|access_token)\s*=\s*[^&\s"'<>]+/gi, '$1=[REDACTED]')
    .replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;"'<>]+/gi, 'Authorization: [REDACTED]')
    .replace(/\b(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/gi, '$1')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]')
    .replace(/\bgsk_[0-9A-Za-z_-]{10,}\b/g, '[REDACTED]')
    .replace(/\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2})\b/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
