import { TelegramClient } from './telegram.client';

/**
 * The sender. A fake Telegram answers each call with whatever the test lines
 * up; waiting is recorded, not slept.
 */
describe('TelegramClient', () => {
  const TOKEN = '123456:secret-token';

  function build(replies: Array<Record<string, unknown> | Error>) {
    const calls: Array<{ url: string; body: any }> = [];
    const waits: number[] = [];
    const fetchFake = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body instanceof FormData ? init.body : JSON.parse(String(init.body)) });
      const next = replies.shift() ?? { ok: true, result: {} };
      if (next instanceof Error) throw next;
      return { status: 200, text: async () => JSON.stringify(next) } as unknown as Response;
    });
    const client = new TelegramClient({
      token: TOKEN, apiBase: 'https://tg.test', webhookBase: null, jwtSecret: 'jwt',
      gapMs: 0, maxAttempts: 3, maxQueued: 3, maxQueuedPhotos: 1,
      fetch: fetchFake as unknown as typeof fetch,
      sleep: async (ms) => { waits.push(ms); },
    });
    return { client, calls, waits };
  }

  it('sends HTML messages in order, one at a time', async () => {
    const { client, calls } = build([]);
    client.sendMessage('111', 'one');
    client.sendMessage('222', 'two');
    await client.idle();
    expect(calls.map((c) => [c.body.chat_id, c.body.text, c.body.parse_mode])).toEqual([['111', 'one', 'HTML'], ['222', 'two', 'HTML']]);
    expect(calls[0].url).toBe(`https://tg.test/bot${TOKEN}/sendMessage`);
  });

  it('waits as long as Telegram asks on 429, then sends', async () => {
    const { client, calls, waits } = build([{ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }]);
    client.sendMessage('111', 'hello');
    await client.idle();
    expect(waits).toContain(7000);
    expect(calls).toHaveLength(2);
  });

  it('drops a message Telegram refuses (400) and moves on to the next one', async () => {
    const { client, calls } = build([{ ok: false, error_code: 400, description: 'can\'t parse entities' }]);
    client.sendMessage('111', 'bad');
    client.sendMessage('111', 'good');
    await client.idle();
    expect(calls.map((c) => c.body.text)).toEqual(['bad', 'good']);
    expect(client.dropped).toBe(1);
  });

  it('a chat that blocked the bot (403) is reported so it gets unlinked, and not retried', async () => {
    const { client, calls } = build([{ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }]);
    const gone: string[] = [];
    client.onChatGone((id) => { gone.push(id); });
    client.sendMessage('111', 'hello');
    await client.idle();
    expect(gone).toEqual(['111']);
    expect(calls).toHaveLength(1);
  });

  it('a network failure backs off and retries, then gives up after the last try', async () => {
    const { client, calls, waits } = build([new Error(`connect failed https://tg.test/bot${TOKEN}/sendMessage`), new Error('again'), new Error('and again')]);
    const warn = jest.spyOn((client as any).logger, 'warn').mockImplementation(() => undefined);
    client.sendMessage('111', 'hello');
    client.sendMessage('222', 'after');
    await client.idle();
    expect(calls.map((c) => c.body.chat_id)).toEqual(['111', '111', '111', '222']);
    expect(waits.filter((w) => w >= 1000)).toHaveLength(2);
    expect(client.dropped).toBe(1);
    // The token never reaches the logs.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
  });

  it('a full outbox drops new alerts instead of growing without end', async () => {
    const { client } = build([]);
    (client as any).draining = true;   // hold the queue still
    for (let i = 0; i < 5; i++) client.sendMessage('111', `m${i}`);
    expect(client.queued).toBe(3);
    expect(client.dropped).toBe(2);
  });

  it('photos go as a multipart upload with the caption; past the photo cap the caption goes alone', async () => {
    const { client, calls } = build([]);
    (client as any).draining = true;
    client.sendPhoto('111', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 'caption one', 'fallback one');
    client.sendPhoto('111', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 'caption two', 'fallback two');
    (client as any).draining = false;
    client.sendMessage('111', 'kick');
    await client.idle();
    const photo = calls[0].body as FormData;
    expect(calls[0].url).toMatch(/\/sendPhoto$/);
    expect(photo.get('chat_id')).toBe('111');
    expect(photo.get('caption')).toBe('caption one');
    expect((photo.get('photo') as Blob).size).toBe(3);
    expect(calls.slice(1).map((c) => c.body.text)).toEqual(['fallback two', 'kick']);
  });

  it('with no token nothing is queued or called', async () => {
    const fetchFake = jest.fn();
    const client = new TelegramClient({ token: null, jwtSecret: 'jwt', fetch: fetchFake as unknown as typeof fetch });
    client.sendMessage('111', 'hello');
    expect(client.enabled).toBe(false);
    expect(client.queued).toBe(0);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});
