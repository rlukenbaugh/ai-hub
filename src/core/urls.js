'use strict';
// Which web addresses a web tile may use.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A web tile address: any https site, or http on this computer only (for local AI web pages
 * such as Open WebUI or LM Studio). No user names or passwords inside the address.
 * @param {string} input  what was typed; "chatgpt.com" is read as https://chatgpt.com/
 * @returns {string|null} the cleaned address, or null if it cannot be used
 */
function safeWebUrl(input) {
  let text = String(input || '').trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let u;
  try { u = new URL(text); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:') return u.hostname.includes('.') || LOCAL_HOSTS.has(u.hostname) ? u.href : null;
  if (u.protocol === 'http:') return LOCAL_HOSTS.has(u.hostname) ? u.href : null;
  return null;
}

/** Links a web page may hand to the default browser (never file:, javascript: and so on). */
function externalUrl(input) {
  let u;
  try { u = new URL(String(input || '')); } catch { return null; }
  return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : null;
}

/** Pages inside a web tab may go anywhere on the web (sign-in pages redirect across sites). */
function navigable(input) {
  try { return ['https:', 'http:'].includes(new URL(String(input || '')).protocol); } catch { return false; }
}

function hostOf(input) {
  try { return new URL(String(input)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

module.exports = { safeWebUrl, externalUrl, navigable, hostOf };
