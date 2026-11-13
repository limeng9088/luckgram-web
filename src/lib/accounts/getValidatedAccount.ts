import {ActiveAccountNumber} from '@lib/accounts/types';
import {MAX_ACCOUNTS} from '@lib/accounts/constants';

export function getValidatedAccount(input: string | number) {
  input = parseInt((input || '1') + '');
  return (input <= MAX_ACCOUNTS && input >= 1 ? input : 1) as ActiveAccountNumber;
}
