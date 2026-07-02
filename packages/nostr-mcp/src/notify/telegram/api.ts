/**
 * Zero-dependency Telegram Bot API client over Node's global fetch (Node 22+).
 * Only the handful of methods the bridge needs, plus error classification:
 *   - GoneError: the chat is permanently unreachable (bot blocked, chat/user
 *     not found) → the caller prunes the subscription/group, like web-push 410.
 *   - RetryAfterError: 429 flood limit, carries retry_after seconds.
 */
export class GoneError extends Error {}
export class RetryAfterError extends Error {
  constructor(readonly retryAfterSec: number) { super(`retry after ${retryAfterSec}s`); }
}

export interface InlineButton { text: string; url?: string; callback_data?: string }
export interface SendOpts {
  parseMode?: 'HTML' | 'MarkdownV2';
  buttons?: InlineButton[][];
  replyToMessageId?: number;
  disablePreview?: boolean;
}

interface ApiResponse<T> { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } }

/** A Telegram message id + the chat it lives in (for later edits). */
export interface SentMessage { message_id: number; chat: { id: number } }

export class TelegramApi {
  /** Injected in tests; defaults to global fetch. */
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params ?? {}),
    });
    const json = (await res.json()) as ApiResponse<T>;
    if (json.ok) return json.result as T;

    const code = json.error_code;
    const desc = (json.description ?? '').toLowerCase();
    if (code === 429) throw new RetryAfterError(json.parameters?.retry_after ?? 1);
    // Permanent unreachability — prune the target.
    if (code === 403 || (code === 400 && (desc.includes('chat not found') || desc.includes('user is deactivated') || desc.includes('bot was blocked')))) {
      throw new GoneError(json.description ?? 'gone');
    }
    throw new Error(`telegram ${method} failed (${code}): ${json.description}`);
  }

  async getMe(): Promise<{ id: number; username: string }> {
    return this.call('getMe');
  }

  async getUpdates(offset: number, timeoutSec: number, allowed: string[]): Promise<TgUpdate[]> {
    return this.call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: allowed });
  }

  async sendMessage(chatId: number, text: string, opts: SendOpts = {}): Promise<SentMessage> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
      ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
      ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
      ...(opts.disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
    });
  }

  async editMessageText(chatId: number, messageId: number, text: string, opts: SendOpts = {}): Promise<void> {
    try {
      await this.call('editMessageText', {
        chat_id: chatId, message_id: messageId, text,
        ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
        ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
        ...(opts.disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
      });
    } catch (e) {
      // "message is not modified" is a benign no-op; swallow it.
      if (e instanceof Error && e.message.includes('not modified')) return;
      throw e;
    }
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  }

  async getChatMember(chatId: number, userId: number): Promise<{ status: string }> {
    return this.call('getChatMember', { chat_id: chatId, user_id: userId });
  }
}

// ── Update shapes (only the fields the bridge reads) ────────────────────────
export interface TgUser { id: number; username?: string; first_name?: string }
export interface TgChat { id: number; type: string; title?: string }
export interface TgMessage {
  message_id: number; chat: TgChat; from?: TgUser; text?: string;
  location?: { latitude: number; longitude: number };
  reply_to_message?: TgMessage;
}
export interface TgCallbackQuery { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
}
