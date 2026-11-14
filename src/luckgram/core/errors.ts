/*
 * Luckgram Web (luckgram-specs#139, W3 需求 9): an error of the Luckgram API. `code` is the
 * server's error code, or one of the client's own below. The codes and their texts are the
 * phones' (LuckgramAIError.java, LuckgramStrings.errorMessage).
 */

export class LuckgramApiError extends Error {
  // * the server's
  public static QUOTA_EXCEEDED = 'quota_exceeded';
  public static CONTENT_REJECTED = 'content_rejected';
  public static UPSTREAM_UNAVAILABLE = 'upstream_unavailable';
  public static RATE_LIMITED = 'rate_limited';
  public static INVALID_TOKEN = 'invalid_token';
  public static INVALID_REQUEST = 'invalid_request';
  public static INPUT_TOO_LARGE = 'input_too_large';
  public static NOT_PRO = 'not_pro';
  public static CREDITS_EXHAUSTED = 'credits_exhausted';
  // * the client's
  public static NETWORK_ERROR = 'network_error';
  public static CONSENT_DENIED = 'consent_denied';
  public static CANCELLED = 'cancelled';

  public retryAfterSeconds = 0;

  constructor(public code: string, public status = 0) {
    super(code);
    this.name = 'LuckgramApiError';
  }
}

export function codeForStatus(status: number): string {
  if(status === 401) return LuckgramApiError.INVALID_TOKEN;
  if(status === 413) return LuckgramApiError.INPUT_TOO_LARGE;
  if(status === 429) return LuckgramApiError.RATE_LIMITED;
  if(status >= 400 && status < 500) return LuckgramApiError.INVALID_REQUEST;
  return LuckgramApiError.UPSTREAM_UNAVAILABLE;
}

/** The error of a response that is not a success: `{"error": {"code", "message", "retry_after_seconds"}}`. */
export function errorFromResponse(status: number, bodyText: string | undefined): LuckgramApiError {
  let body: any;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch(err) {}

  const serverError = body && typeof(body.error) === 'object' ? body.error : undefined;
  let code: string = typeof(serverError?.code) === 'string' && serverError.code ? serverError.code : codeForStatus(status);
  if(code === 'unauthorized') code = LuckgramApiError.INVALID_TOKEN;

  const error = new LuckgramApiError(code, status);
  error.retryAfterSeconds = Math.max(0, Number(serverError?.retry_after_seconds) || 0);
  return error;
}

/** The text shown for an error: [中文, English]. */
export function errorMessage(code: string): [string, string] {
  switch(code) {
    case LuckgramApiError.QUOTA_EXCEEDED:
      return ['今天的 AI 额度已用完，请明天再试。', 'You\'ve used up today\'s AI quota. Please try again tomorrow.'];
    case LuckgramApiError.CONTENT_REJECTED:
      return ['内容被 AI 服务拒绝。', 'The content was rejected by the AI service.'];
    case LuckgramApiError.RATE_LIMITED:
      return ['请求太频繁，请稍后再试。', 'Too many requests. Please wait a moment and try again.'];
    case LuckgramApiError.NETWORK_ERROR:
      return ['网络错误，请检查网络后重试。', 'Network error. Please check your connection and try again.'];
    case LuckgramApiError.CONSENT_DENIED:
      return ['你没有同意使用 AI 服务。', 'You didn\'t allow the AI service.'];
    case LuckgramApiError.INPUT_TOO_LARGE:
      return ['内容太长，无法处理。', 'The content is too large to process.'];
    case LuckgramApiError.NOT_PRO:
      return ['此功能需要 Luckgram Pro。', 'This needs Luckgram Pro.'];
    case LuckgramApiError.CREDITS_EXHAUSTED:
      return ['本周期的 AI 点数已用完。', 'No AI credits left in this period.'];
    case LuckgramApiError.CANCELLED:
      return ['已取消。', 'Cancelled.'];
    default:
      return ['AI 服务暂时不可用，请稍后再试。', 'The AI service is temporarily unavailable. Please try again later.'];
  }
}
