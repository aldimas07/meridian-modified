/**
 * sanitize.js — LLM prompt injection guardrails
 *
 * Central sanitization for all untrusted text that flows into LLM prompts.
 * Defense-in-depth: Unicode normalization + pattern detection + length caps.
 */

// ─── Zero-width & invisible Unicode chars ────────────────────────
// Attackers use these to hide instruction text from human reviewers
// while LLMs still read them.
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD]/g;

// ─── Homoglyph normalization ────────────────────────────────────
// Map visually-similar Unicode chars to ASCII equivalents.
// Catches "ＩＧＮＯＲＥ" (fullwidth) → "IGNORE", "ℛℯ𝒶𝒹" → "Read", etc.
const HOMOGLYPH_MAP = new Map([
  // Fullwidth letters → ASCII
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("").flatMap((c, i) => {
    const fullwidth = String.fromCharCode(0xFF21 + i < 0xFF3B ? 0xFF21 + i : 0xFF41 + i - 26);
    return [[fullwidth, c]];
  }),
  // Fullwidth digits
  ..."0123456789".split("").flatMap((c, i) => [[String.fromCharCode(0xFF10 + i), c]]),
  // Common Cyrillic lookalikes
  ["а", "a"], ["е", "e"], ["о", "o"], ["р", "p"], ["с", "c"], ["у", "y"], ["х", "x"],
  ["А", "A"], ["В", "B"], ["Е", "E"], ["К", "K"], ["М", "M"], ["Н", "H"], ["О", "O"],
  ["Р", "P"], ["С", "C"], ["Т", "T"], ["У", "Y"], ["Х", "X"],
  // Math/script/bold Unicode
  ["𝗶", "i"], ["𝗴", "g"], ["𝗻", "n"], ["𝗼", "o"], ["𝗿", "r"], ["𝗲", "e"],
  ["𝒂", "a"], ["𝒃", "b"], ["𝒄", "c"], ["𝒅", "d"],
]);

function normalizeHomoglyphs(text) {
  let result = "";
  for (const char of text) {
    result += HOMOGLYPH_MAP.get(char) || char;
  }
  return result;
}

// ─── Instruction-pattern detection ───────────────────────────────
// Patterns that indicate prompt injection attempts.
// Returns true if text contains suspicious instruction patterns.
const INJECTION_PATTERNS = [
  // Direct instruction verbs at start or after punctuation
  /\b(ignore|disregard|forget|override|bypass)\s+(all|previous|prior|above|earlier|system)\s*(instructions?|rules?|prompts?|guidelines?|constraints?)?/i,
  /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as|new\s+instructions?|system\s*prompt)/i,
  /\b(deploy|send|transfer|withdraw|swap)\s+(all|maximum|entire|full|everything|100%)\b/i,
  /\b(deploy|send|transfer)\s+\d+(\.\d+)?\s*(sol|usd|usdc)\b/i,
  // XML/markdown injection
  /<\/?(system|assistant|user|inst(ruction)?|prompt|context)>/i,
  /\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>/i,
  // Common jailbreak prefixes
  /\b(DAN|jailbreak|developer\s+mode|bypass\s+mode|god\s+mode)\b/i,
  /\bpretend\s+you\s+have\s+no\s+(restrictions?|rules?|limits?|constraints?)\b/i,
  // Markdown/code injection
  /```[\s\S]*(system|assistant|instruction)/i,
  // Encoded payloads
  /\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i,
  /base64[,:]\s*[A-Za-z0-9+/=]{50,}/i,
];

export function containsInjectionPattern(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = normalizeHomoglyphs(text).replace(ZERO_WIDTH_RE, "");
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ─── Core sanitizer ──────────────────────────────────────────────
/**
 * Sanitize untrusted text for LLM prompt injection.
 *
 * Layers:
 * 1. Strip zero-width Unicode chars
 * 2. Normalize homoglyphs to ASCII
 * 3. Strip control chars, newlines, HTML-like tags
 * 4. Collapse whitespace
 * 5. Truncate to maxLen
 * 6. JSON.stringify to escape any remaining special chars
 *
 * @param {string} text - Untrusted input
 * @param {number} maxLen - Max character length (default 200)
 * @returns {string|null} Sanitized string or null if empty
 */
export function sanitizeForPrompt(text, maxLen = 200) {
  if (text == null) return null;
  const cleaned = String(text)
    .replace(ZERO_WIDTH_RE, "")          // strip invisible chars
    // homoglyph normalize step-by-step to avoid regex range issues
    .split("")
    .map((c) => HOMOGLYPH_MAP.get(c) || c)
    .join("")
    .replace(/[\r\n\t]+/g, " ")           // collapse control whitespace
    .replace(/[<>`{}[\]\\]/g, "")          // strip markdown/HTML injection chars
    .replace(/\s+/g, " ")                  // collapse whitespace
    .trim()
    .slice(0, maxLen);
  return cleaned || null;
}

/**
 * Sanitize pool/token name for LLM prompt.
 * More restrictive than sanitizeForPrompt — names should be short alphanumeric.
 *
 * @param {string} name - Pool or token name
 * @param {number} maxLen - Max length (default 60)
 * @returns {string} Sanitized name, or "[REDACTED]" if injection detected
 */
export function sanitizeName(name, maxLen = 60) {
  if (!name) return "?";
  const raw = String(name);

  // Check for injection patterns first
  if (containsInjectionPattern(raw)) {
    return "[REDACTED]";
  }

  // Strip to safe chars only: alphanumeric, space, dash, underscore, slash, dot
  const cleaned = raw
    .replace(ZERO_WIDTH_RE, "")
    .split("")
    .map((c) => HOMOGLYPH_MAP.get(c) || c)
    .join("")
    .replace(/[^a-zA-Z0-9\s\-_./()$%]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);

  return cleaned || "?";
}

/**
 * Sanitize narrative/metadata text — longer, more descriptive.
 * Detects injection patterns and wraps result if suspicious.
 *
 * @param {string} text - Narrative text from external source
 * @param {number} maxLen - Max length (default 500)
 * @returns {string|null} Sanitized text, or null if injection detected
 */
export function sanitizeNarrative(text, maxLen = 500) {
  if (!text) return null;
  const raw = String(text);

  // Hard reject if injection patterns detected
  if (containsInjectionPattern(raw)) {
    return null;
  }

  return sanitizeForPrompt(raw, maxLen);
}

/**
 * Wrapper for existing sanitize patterns in the codebase.
 * Drop-in replacement for the various sanitize* functions.
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {string|null}
 */
export function sanitizeText(text, maxLen = 280) {
  if (text == null) return null;
  const cleaned = String(text)
    .replace(ZERO_WIDTH_RE, "")
    .split("")
    .map((c) => HOMOGLYPH_MAP.get(c) || c)
    .join("")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned || null;
}
