import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { webhookSecret } from './link-token';

/**
 * Talks to the Telegram Bot API with Node's own fetch -- no library.
 *
 * Built on what the Trade Bot learned:
 *   - Sending never blocks the work that caused it. A sale or a purchase puts
 *     its alert in an outbox and returns; one loop drains it in order.
 *   - 429 waits exactly as long as Telegram asks. A 5xx or a network failure
 *     backs off (1 s doubling to 30 s) and gives up on that message after six
 *     tries. A 400 is dropped at once and logged with Telegram's reason, and a
 *     403 (the person blocked the bot) also unlinks that chat.
 *   - A message leaves the outbox by identity, never by position: removing
 *     "the first one" while an older one is mid-send dropped the wrong alert.
 *   - The bot token is part of every URL, so no URL is ever logged, and any
 *     text that is logged has the token scrubbed out.
 *
 * The outbox is in memory. A redeploy while alerts are queued loses those
 * alerts -- never the sale or the purchase, which are already saved.
 */

export const TELEGRAM_CLIENT_OPTIONS = Symbol('TELEGRAM_CLIENT_OPTIONS');

export interface TelegramClientOptions {
  token: string | null;
  apiBase: string;
  /** Public https base of this API, for the webhook. Null: no webhook is registered. */
  webhookBase: string | null;
  jwtSecret: string;
  /** Pause between sends. Telegram allows about 30 messages a second per bot. */
  gapMs: number;
  maxAttempts: number;
  maxQueued: number;
  maxQueuedPhotos: number;
  /** For tests: replaces setTimeout-based waiting. */
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

type Outgoing =
  | { kind: 'message'; chatId: string; text: string; attempts: number }
  | { kind: 'photo'; chatId: string; photo: Buffer; mime: string; filename: string; caption: string; attempts: number };

interface ApiReply<T> { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } }

function fromEnv(): TelegramClientOptions {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return {
    token,
    apiBase: (process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, ''),
    webhookBase: (process.env.TELEGRAM_WEBHOOK_BASE?.trim() || (railway ? `https://${railway}` : '') || null)?.replace(/\/+$/, '') ?? null,
    jwtSecret: process.env.JWT_ACCESS_SECRET ?? '',
    gapMs: 40,
    maxAttempts: 6,
    maxQueued: 5000,
    maxQueuedPhotos: 50,
  };
}

@Injectable()
export class TelegramClient implements OnModuleInit {
  private readonly logger = new Logger('Telegram');
  private readonly opts: TelegramClientOptions;
  private readonly outbox: Outgoing[] = [];
  private draining = false;
  private username: string | null = null;
  private chatGone: Array<(chatId: string) => Promise<void> | void> = [];
  /** Seen in logs and in tests: what was given up on. */
  dropped = 0;

  constructor(@Optional() @Inject(TELEGRAM_CLIENT_OPTIONS) options?: Partial<TelegramClientOptions>) {
    this.opts = { ...fromEnv(), ...(options ?? {}) };
  }

  get enabled(): boolean {
    return !!this.opts.token && !!this.opts.jwtSecret;
  }

  /** The token and JWT secret, for signing link codes. Never logged. */
  get secrets(): { botToken: string; jwtSecret: string } {
    return { botToken: this.opts.token ?? '', jwtSecret: this.opts.jwtSecret };
  }

  get webhookSecret(): string | null {
    return this.enabled ? webhookSecret(this.opts.jwtSecret, this.opts.token!) : null;
  }

  onChatGone(fn: (chatId: string) => Promise<void> | void) {
    this.chatGone.push(fn);
  }

  onModuleInit() {
    if (!this.opts.token) {
      this.logger.log('TELEGRAM_BOT_TOKEN is not set: Telegram alerts are off.');
      return;
    }
    // Not awaited: a slow or unreachable Telegram must not hold up the API starting.
    void this.start();
  }

  private async start() {
    await this.botUsername();
    if (!this.opts.webhookBase) {
      this.logger.warn('No public address for the webhook (TELEGRAM_WEBHOOK_BASE or RAILWAY_PUBLIC_DOMAIN): alerts can be sent, but nobody can link a chat.');
      return;
    }
    const res = await this.call<boolean>('setWebhook', {
      url: `${this.opts.webhookBase}/api/v1/telegram/webhook`,
      secret_token: this.webhookSecret,
      allowed_updates: ['message', 'my_chat_member'],
    });
    if (res.ok) this.logger.log(`Webhook registered at ${this.opts.webhookBase}/api/v1/telegram/webhook`);
    else this.logger.warn(`Could not register the webhook: ${this.scrub(res.description ?? 'no reason given')}`);
  }

  /** The bot's @username, asked once and remembered. Null while Telegram cannot be reached. */
  async botUsername(): Promise<string | null> {
    if (this.username || !this.enabled) return this.username;
    const me = await this.call<{ username?: string }>('getMe', {});
    if (me.ok && me.result?.username) {
      this.username = me.result.username;
      this.logger.log(`Connected as @${this.username}`);
    } else {
      this.logger.warn(`Telegram getMe failed: ${this.scrub(me.description ?? 'unreachable')}`);
    }
    return this.username;
  }

  sendMessage(chatId: string, html: string): void {
    if (!this.enabled) return;
    if (this.outbox.length >= this.opts.maxQueued) {
      this.dropped++;
      this.logger.warn(`Outbox full (${this.opts.maxQueued}); an alert was not sent.`);
      return;
    }
    this.outbox.push({ kind: 'message', chatId, text: html, attempts: 0 });
    void this.drain();
  }

  sendPhoto(chatId: string, photo: Buffer, mime: string, captionHtml: string, textIfNoRoom: string): void {
    if (!this.enabled) return;
    const photos = this.outbox.filter((o) => o.kind === 'photo').length;
    // Photos are held in memory until sent; past the cap the words still go, without the picture.
    if (photos >= this.opts.maxQueuedPhotos) {
      this.logger.warn('Too many photos waiting to send; sending the caption without the picture.');
      this.sendMessage(chatId, textIfNoRoom);
      return;
    }
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    this.outbox.push({ kind: 'photo', chatId, photo, mime, filename: `receipt.${ext}`, caption: captionHtml, attempts: 0 });
    void this.drain();
  }

  /** How many alerts are waiting. For tests and the logs. */
  get queued(): number {
    return this.outbox.length;
  }

  /** Resolves when the outbox is empty. For tests. */
  async idle(): Promise<void> {
    while (this.draining || this.outbox.length > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.outbox.length > 0) {
        const item = this.outbox[0];
        const res = item.kind === 'message'
          ? await this.call('sendMessage', { chat_id: item.chatId, text: item.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
          : await this.callMultipart('sendPhoto', item);

        if (res.ok) {
          this.remove(item);
          await this.sleep(this.opts.gapMs);
          continue;
        }
        const code = res.error_code ?? 0;
        if (code === 429) {
          const wait = Math.min(60, Math.max(1, res.parameters?.retry_after ?? 1));
          await this.sleep(wait * 1000);
          continue;
        }
        if (code === 403) {
          this.remove(item);
          this.logger.warn(`Chat refused the bot (${this.scrub(res.description ?? '403')}); unlinking it.`);
          for (const fn of this.chatGone) {
            try { await fn(item.chatId); } catch (err) { this.logger.warn(`Could not unlink a refused chat: ${this.scrub(String(err))}`); }
          }
          continue;
        }
        if (code >= 400 && code < 500) {
          this.remove(item);
          this.dropped++;
          this.logger.warn(`Telegram refused a ${item.kind} (${code}): ${this.scrub(res.description ?? 'no reason given')}`);
          continue;
        }
        item.attempts++;
        if (item.attempts >= this.opts.maxAttempts) {
          this.remove(item);
          this.dropped++;
          this.logger.warn(`Gave up on a ${item.kind} after ${item.attempts} tries: ${this.scrub(res.description ?? 'unreachable')}`);
          continue;
        }
        const backoff = Math.min(30_000, 1000 * 2 ** (item.attempts - 1));
        await this.sleep(backoff + Math.floor(Math.random() * 250));
      }
    } finally {
      this.draining = false;
    }
  }

  private remove(item: Outgoing) {
    const at = this.outbox.indexOf(item);
    if (at >= 0) this.outbox.splice(at, 1);
  }

  /** One Bot API call with a JSON body. Never throws; a failure comes back as ok: false. */
  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<ApiReply<T>> {
    if (!this.opts.token) return { ok: false, description: 'Telegram is not configured' };
    return this.request<T>(method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);
  }

  private async callMultipart(method: string, item: Extract<Outgoing, { kind: 'photo' }>): Promise<ApiReply<unknown>> {
    const form = new FormData();
    form.append('chat_id', item.chatId);
    form.append('caption', item.caption);
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([new Uint8Array(item.photo)], { type: item.mime }), item.filename);
    return this.request(method, { method: 'POST', body: form }, 45_000);
  }

  private async request<T>(method: string, init: RequestInit, timeoutMs: number): Promise<ApiReply<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const f = this.opts.fetch ?? fetch;
      const res = await f(`${this.opts.apiBase}/bot${this.opts.token}/${method}`, { ...init, signal: ctrl.signal });
      const text = await res.text();
      try {
        return JSON.parse(text) as ApiReply<T>;
      } catch {
        return { ok: false, error_code: res.status, description: `HTTP ${res.status}` };
      }
    } catch (err) {
      // A network failure or timeout: no error_code, so the drain treats it as worth retrying.
      return { ok: false, description: this.scrub(err instanceof Error ? err.message : String(err)) };
    } finally {
      clearTimeout(timer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return this.opts.sleep ? this.opts.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  private scrub(s: string): string {
    return this.opts.token ? s.split(this.opts.token).join('<token>') : s;
  }
}
