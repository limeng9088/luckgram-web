import type {TrueDcId} from '@types';
import type {ActiveAccountNumber} from '@lib/accounts/types';

export const CURRENT_ACCOUNT_QUERY_PARAM = 'account';

// * Luckgram (luckgram-specs#140, W4): 20 accounts, with Telegram Premium or without. Upstream: 3, and 4 with
// * Premium. Everything that goes over the account slots goes by ACCOUNT_NUMBERS; the type
// * (ActiveAccountNumber, types.d.ts) has to list the same numbers — src/tests/luckgramAccounts.test.ts checks.
export const MAX_ACCOUNTS = 20;
export const MAX_ACCOUNTS_FREE = MAX_ACCOUNTS;
export const MAX_ACCOUNTS_PREMIUM = MAX_ACCOUNTS;
export const ACCOUNT_NUMBERS: readonly ActiveAccountNumber[] = Array.from({length: MAX_ACCOUNTS}, (_, index) => (index + 1) as ActiveAccountNumber);

export const DC_IDS: TrueDcId[] = [1, 2, 3, 4, 5];
