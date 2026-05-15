
export type TTransactionType   = 'CREDIT' | 'DEBIT';
export type TTransactionSource =
  | 'RIDE_EARNING'
  | 'ADMIN_COMMISSION'
  | 'RIDE_PAYMENT'
  | 'WITHDRAWAL'
  | 'REFUND'
  | 'BONUS'
  | 'TOP_UP';

export type TWithdrawalMethod = 'BANK_TRANSFER' | 'MOBILE_BANKING';
export type TWithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
