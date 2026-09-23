import {
  parseGoogleCredentials,
  readGoogleCredentials,
  GOOGLE_CREDENTIALS_VAR,
} from './google-credentials';

/**
 * The service-account key arrives by copy-and-paste, into a web form, once,
 * from someone who will be on a bus. Everything here is about that one paste.
 *
 * Two kinds of failure are being defended against. The first is a key that
 * does not work and says so unhelpfully — Google's answer to a PEM whose line
 * breaks were flattened is a signature error, which sends you looking at IAM
 * roles for an hour. The second is worse: a key that ends up in a log line.
 * Railway keeps logs, logs get pasted into chat, and a service-account private
 * key is a standing grant of Vertex on the project.
 *
 * So: forgive every paste that can be forgiven, name the variable when it
 * cannot, and never repeat a single character of what was pasted.
 */

/*
  Obviously-fake key material. The shape is what matters — BEGIN/END markers
  and a body — and nothing here has ever been a real key.
*/
const FAKE_PEM_BODY = 'MIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA0FAKE';
const REAL_NEWLINE_PEM =
  `-----BEGIN PRIVATE KEY-----\n${FAKE_PEM_BODY}\n-----END PRIVATE KEY-----\n`;

/** The key file as Google writes it: newlines inside the PEM are escaped. */
function keyFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type:          'service_account',
    project_id:    'clerque-ai',
    private_key_id: 'abc123',
    private_key:   REAL_NEWLINE_PEM,
    client_email:  'clerque-vertex@clerque-ai.iam.gserviceaccount.com',
    client_id:     '123456789',
    token_uri:     'https://oauth2.googleapis.com/token',
    ...overrides,
  });
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('parseGoogleCredentials — what the paste may look like', () => {
  it('reads the key file exactly as Google downloads it', () => {
    const creds = parseGoogleCredentials(keyFile());
    expect(creds).toEqual({
      client_email: 'clerque-vertex@clerque-ai.iam.gserviceaccount.com',
      private_key:  REAL_NEWLINE_PEM,
      project_id:   'clerque-ai',
    });
  });

  it('reads the same file base64-encoded, which is what survives a dashboard', () => {
    expect(parseGoogleCredentials(b64(keyFile()))).toEqual(parseGoogleCredentials(keyFile()));
  });

  it('ignores the line wrapping a text box adds to a long base64 value', () => {
    const wrapped = (b64(keyFile()).match(/.{1,64}/g) ?? []).join('\n');
    expect(parseGoogleCredentials(`  ${wrapped}  `)).toEqual(parseGoogleCredentials(keyFile()));
  });

  /*
    The single most common way this breaks. A shell, a YAML file, or a second
    round of JSON encoding turns each newline in the PEM into the two
    characters backslash-n. Google then rejects the key with a signature
    error that names nothing, and the hunt starts in IAM.
  */
  it('repairs a private key whose newlines arrived escaped', () => {
    const escaped = keyFile({ private_key: REAL_NEWLINE_PEM.replace(/\n/g, '\\n') });
    expect(parseGoogleCredentials(escaped)!.private_key).toBe(REAL_NEWLINE_PEM);
  });

  it('repairs escaped Windows line endings too', () => {
    const escaped = keyFile({ private_key: REAL_NEWLINE_PEM.replace(/\n/g, '\\r\\n') });
    expect(parseGoogleCredentials(escaped)!.private_key).toBe(REAL_NEWLINE_PEM);
  });

  /*
    The mirror image: a field that helpfully turned the file's escaped
    newlines into real ones, which makes the JSON itself illegal. A newline
    between fields is fine and must stay fine; only the ones inside the PEM
    are the problem.
  */
  it('repairs a key file whose JSON was broken by real newlines inside the key', () => {
    const pretty = JSON.stringify(JSON.parse(keyFile()), null, 2);
    const broken = pretty.replace(/\\n/g, '\n');
    expect(() => JSON.parse(broken)).toThrow();          // genuinely invalid JSON
    expect(parseGoogleCredentials(broken)!.private_key).toBe(REAL_NEWLINE_PEM);
  });

  it('handles both damages at once — base64 of a file with real newlines in it', () => {
    const broken = keyFile().replace(/\\n/g, '\n');
    expect(parseGoogleCredentials(b64(broken))!.private_key).toBe(REAL_NEWLINE_PEM);
  });

  it('strips a wrapping pair of quotes picked up from a .env line', () => {
    expect(parseGoogleCredentials(`"${keyFile()}"`)).toEqual(parseGoogleCredentials(keyFile()));
    expect(parseGoogleCredentials(`'${b64(keyFile())}'`)).toEqual(parseGoogleCredentials(keyFile()));
  });

  it('carries the project id, so GOOGLE_CLOUD_PROJECT is optional', () => {
    expect(parseGoogleCredentials(keyFile())!.project_id).toBe('clerque-ai');
  });

  it('omits project_id rather than carrying an empty one', () => {
    expect(parseGoogleCredentials(keyFile({ project_id: '' }))).not.toHaveProperty('project_id');
  });
});

describe('parseGoogleCredentials — absent is not broken', () => {
  /*
    An unset variable means "look for credentials the normal Google way",
    which is exactly right on a developer's machine after `gcloud auth
    application-default login`. Turning that into an error would break local
    work to fix a Railway problem.
  */
  it.each([undefined, null, '', '   ', '\n\t '])('treats %p as "not configured", not as an error', (raw) => {
    expect(parseGoogleCredentials(raw as string | undefined | null)).toBeNull();
  });
});

describe('parseGoogleCredentials — what it refuses, and how plainly', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['plain junk',             'not-a-key-at-all',                                  /neither JSON nor base64/i],
    ['a bare API key',         'AIzaSyB-notarealkey-0000000000000000000',            /neither JSON nor base64/i],
    ['base64 of junk',         b64('hello there'),                                  /neither JSON nor base64/i],
    ['truncated JSON',         '{"client_email":"a@b.c","private_key":"x"',          /not valid JSON/i],
    ['a JSON list',            '["service_account"]',                               /not a list/i],
    ['no client_email',        keyFile({ client_email: undefined }),                /client_email/],
    ['a blank client_email',   keyFile({ client_email: '   ' }),                    /client_email/],
    ['no private_key',         keyFile({ private_key: undefined }),                 /private_key/],
    ['a non-PEM private_key',  keyFile({ private_key: 'AIzaSyB-notarealkey' }),     /not a PEM key/i],
  ];

  it.each(cases)('refuses %s, naming the variable', (_label, raw, expected) => {
    expect(() => parseGoogleCredentials(raw)).toThrow(expected);
    expect(() => parseGoogleCredentials(raw)).toThrow(new RegExp(GOOGLE_CREDENTIALS_VAR));
  });

  it('names whichever variable it was told to read', () => {
    expect(() => parseGoogleCredentials('junk', 'SOME_OTHER_VAR')).toThrow(/SOME_OTHER_VAR/);
  });
});

/**
 * The one that matters most.
 *
 * Every message here is written to a log the owner may well paste into a
 * chat window while asking why AI is down. Not one character of the key may
 * travel with it — not the PEM, not the body of the PEM, not the client
 * email, not the raw value that was pasted.
 */
describe('nothing secret ever reaches a message or a log', () => {
  /*
    The PEM's BEGIN/END markers are deliberately NOT on this list: they are
    boilerplate printed in the advice ("it should begin with ...") and carry
    no key material. What must never appear is the body, the whole key, the
    account's identity, or the raw value that was pasted.
  */
  const secrets = [
    FAKE_PEM_BODY,
    REAL_NEWLINE_PEM,
    'clerque-vertex@clerque-ai.iam.gserviceaccount.com',
  ];

  const failing: string[] = [
    'not-a-key-at-all',
    b64('hello there'),
    keyFile({ client_email: undefined }),
    keyFile({ private_key: undefined }),
    keyFile({ private_key: FAKE_PEM_BODY }),           // real body, no PEM markers
    `{"client_email":"a@b.c","private_key":"${FAKE_PEM_BODY}"`,
    b64(keyFile({ client_email: undefined })),
  ];

  it.each(failing)('keeps case %# out of the error message entirely', (raw) => {
    let message = '';
    try {
      parseGoogleCredentials(raw);
      throw new Error('expected parseGoogleCredentials to throw');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain(GOOGLE_CREDENTIALS_VAR);
    for (const secret of secrets) expect(message).not.toContain(secret);
    // Nor the raw value itself, whole or in any recognisable run.
    expect(message).not.toContain(raw.slice(0, 32));
  });

  it('does not put the key in the message when the whole file is unreadable', () => {
    const message = (() => {
      try { parseGoogleCredentials(b64(REAL_NEWLINE_PEM)); return ''; }
      catch (err) { return (err as Error).message; }
    })();
    expect(message).toContain(GOOGLE_CREDENTIALS_VAR);
    expect(message).not.toContain(FAKE_PEM_BODY);
  });
});

describe('readGoogleCredentials — reads the environment at call time', () => {
  it('returns null when the variable is not set', () => {
    expect(readGoogleCredentials({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('reads the variable by its published name', () => {
    const env = { [GOOGLE_CREDENTIALS_VAR]: keyFile() } as unknown as NodeJS.ProcessEnv;
    expect(readGoogleCredentials(env)!.client_email)
      .toBe('clerque-vertex@clerque-ai.iam.gserviceaccount.com');
  });

  it('defaults to process.env, which is how the service calls it', () => {
    const before = process.env[GOOGLE_CREDENTIALS_VAR];
    process.env[GOOGLE_CREDENTIALS_VAR] = b64(keyFile());
    try {
      expect(readGoogleCredentials()!.project_id).toBe('clerque-ai');
    } finally {
      if (before === undefined) delete process.env[GOOGLE_CREDENTIALS_VAR];
      else process.env[GOOGLE_CREDENTIALS_VAR] = before;
    }
  });
});
