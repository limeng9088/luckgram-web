/*
 * Luckgram Web (luckgram-specs#187, W7 需求 7): what an AI call's error says — W3's unified texts.
 */

import {LuckgramApiError, errorMessage} from '@/luckgram/core/errors';
import {lgText} from '@/luckgram/text';

export const getAiErrorText = (err: unknown) => lgText(...errorMessage(err instanceof LuckgramApiError ? err.code : ''));
