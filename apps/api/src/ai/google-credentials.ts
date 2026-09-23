/**
 * The Vertex service-account key, read from an environment variable.
 *
 * Every Google library looks for its credentials in one of two places: a JSON
 * FILE whose path is in GOOGLE_APPLICATION_CREDENTIALS, or a metadata server
 * that only exists inside Google Cloud. Railway has neither — there is nowhere
 * to put a file that survives a deploy, and no metadata server to ask — so the
 * Vertex path could not authenticate at all until this file existed.
 *
 * The way through is the third thing google-auth-library accepts: the contents
 * of that key file, handed over in memory. So Clerque reads the key out of one
 * variable and passes it to the SDK directly.
 *
 * ── What to put in the variable ───────────────────────────────────────────
 * GOOGLE_CREDENTIALS_JSON takes EITHER form, whichever survives the paste:
 *   1. the whole service-account key file, exactly as Google Cloud downloads
 *      it — the thing that starts with `{ "type": "service_account", ...`
 *   2. that same file base64-encoded, which is the safer option in a web
 *      dashboard because it is one unbroken line with no quotes or newlines
 *      for a text box to mangle.
 *
 * ── The paste problems this forgives ──────────────────────────────────────
 *   - Newlines inside the private key arriving as the two characters \ and n
 *     instead of a real line break (what a shell, a YAML file, or a second
 *     round of JSON encoding does to them). A PEM key with those two literal
 *     characters in it is rejected by Google with a signature error that says
 *     nothing useful.
 *   - The reverse: a dashboard turning the key file's escaped newlines into
 *     real line breaks, which makes the JSON itself unparseable.
 *   - A wrapping pair of quotes picked up from a .env file.
 *
 * ── What it will never do ────────────────────────────────────────────────
 * No part of the key — not the private key, not the client email, not the
 * decoded text — is ever put in an error message or a log line. Every failure
 * here names the VARIABLE and says what shape was expected, and nothing else.
 */

/** The variable Clerque reads the Vertex service-account key from. */
export const GOOGLE_CREDENTIALS_VAR = 'GOOGLE_CREDENTIALS_JSON';

/**
 * The fields of a service-account key that Vertex actually needs.
 *
 * Deliberately the snake_case names Google writes in the file, so the object
 * can be handed to google-auth-library unchanged and nobody has to check a
 * mapping when a sign-in fails.
 */
export interface GoogleServiceAccountKey {
  client_email: string;
  private_key:  string;
  /** Present in every key file Google downloads; used when GOOGLE_CLOUD_PROJECT is unset. */
  project_id?:  string;
}

/**
 * Escape the line breaks that only ever appear inside the private key.
 *
 * A newline BETWEEN fields is ordinary JSON whitespace and legal — the key
 * file Google downloads is pretty-printed, so there are plenty of those. A
 * newline INSIDE a quoted string is not legal JSON, and in a service-account
 * key there is exactly one string long enough for a dashboard to wrap: the
 * PEM. So the repair is scoped to string literals rather than applied to the
 * whole blob, which would corrupt the formatting and prove nothing.
 */
function escapeBreaksInsideStrings(json: string): string {
  let out = '';
  let inString = false;
  let escaped  = false;

  for (const ch of json) {
    if (escaped)     { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true;  continue; }
    if (ch === '"')  { out += ch; inString = !inString; continue; }
    if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Strip one matching pair of wrapping quotes, the way a .env line carries them. */
function unwrapQuotes(value: string): string {
  const first = value[0];
  const last  = value[value.length - 1];
  if (value.length >= 2 && (first === '"' || first === "'") && last === first) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/**
 * The key file's text, whichever of the two accepted forms arrived.
 *
 * Returns null when the value is neither — the caller turns that into the
 * "not JSON" message rather than guessing further.
 */
function toJsonText(value: string): string | null {
  // '[' is accepted only so that a list gets the specific "not a list"
  // message below instead of the generic one; it is never a valid key file.
  if (value.startsWith('{') || value.startsWith('[')) return value;

  /*
    Buffer's base64 decoder never throws: it drops anything that is not a
    base64 character and returns whatever is left, so a truncated or plainly
    wrong value comes back as gibberish rather than as an error. Checking for
    the opening brace is what actually separates "this was base64" from "this
    was something else entirely".
  */
  const decoded = Buffer.from(value, 'base64').toString('utf8').trim();
  return decoded.startsWith('{') || decoded.startsWith('[') ? decoded : null;
}

/**
 * Parse a service-account key out of one environment variable's raw value.
 *
 * Returns null when the variable is absent or blank — that is not an error,
 * it means "use the normal Google credential lookup", which is right on a
 * developer's machine where `gcloud auth application-default login` has
 * already left a file behind.
 *
 * Throws, with a message naming the variable and carrying none of its
 * contents, when the variable IS set but cannot be used.
 */
export function parseGoogleCredentials(
  raw:     string | undefined | null,
  varName: string = GOOGLE_CREDENTIALS_VAR,
): GoogleServiceAccountKey | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const value    = unwrapQuotes(trimmed);
  const jsonText = toJsonText(value);
  if (jsonText === null) {
    throw new Error(
      `${varName} is neither JSON nor base64-encoded JSON. Paste the whole ` +
      `service-account key file Google Cloud downloaded (it starts with a "{"), ` +
      `or base64-encode that file and paste the result.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Second try: the dashboard turned the key's escaped newlines into real
    // ones. Nothing else in a key file can break the parse this way.
    try {
      parsed = JSON.parse(escapeBreaksInsideStrings(jsonText));
    } catch {
      throw new Error(
        `${varName} is set but is not valid JSON. Base64-encode the key file ` +
        `and paste that instead — one unbroken line is much harder for a ` +
        `dashboard field to damage.`,
      );
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${varName} must be a service-account key object, not a list or a bare value.`);
  }

  const key = parsed as Record<string, unknown>;
  const clientEmail = typeof key.client_email === 'string' ? key.client_email.trim() : '';
  const privateKey  = typeof key.private_key  === 'string' ? key.private_key         : '';
  const projectId   = typeof key.project_id   === 'string' ? key.project_id.trim()   : '';

  if (!clientEmail) {
    throw new Error(
      `${varName} has no client_email. That field is in every service-account ` +
      `key file; an OAuth client file or an API key is a different thing and ` +
      `will not work with Vertex.`,
    );
  }
  if (!privateKey) {
    throw new Error(
      `${varName} has no private_key. Use the key file from Service accounts ` +
      `→ Keys → Add key → Create new key → JSON, not the service account's ` +
      `details page.`,
    );
  }

  /*
    Line breaks first, then the shape check — a key whose newlines arrived
    escaped still contains BEGIN and END, and rejecting it before repairing it
    would be a false alarm.
  */
  const normalisedKey = privateKey.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  if (!normalisedKey.includes('BEGIN') || !normalisedKey.includes('PRIVATE KEY')) {
    throw new Error(
      `${varName} has a private_key that is not a PEM key. It should begin ` +
      `with "-----BEGIN PRIVATE KEY-----"; if it does not, the file was ` +
      `edited or truncated on the way in.`,
    );
  }

  return {
    client_email: clientEmail,
    private_key:  normalisedKey,
    ...(projectId ? { project_id: projectId } : {}),
  };
}

/**
 * The service-account key this deployment was given, or null for "use the
 * normal Google lookup". Reads the environment at call time rather than at
 * import, so a test can set a variable and, in production, a restart is the
 * only thing that has to happen.
 */
export function readGoogleCredentials(
  env: NodeJS.ProcessEnv = process.env,
): GoogleServiceAccountKey | null {
  return parseGoogleCredentials(env[GOOGLE_CREDENTIALS_VAR], GOOGLE_CREDENTIALS_VAR);
}
