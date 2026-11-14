import crypto from 'crypto';

export function hashSecret(s: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(s, salt, 32).toString('hex')}`;
}
export function verifySecret(s: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(s, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

export type Role = 'owner' | 'manager' | 'accountant' | 'storekeeper' | 'cashier' | 'waiter';
const P: Record<string, Role[]> = {
  sell: ['owner', 'manager', 'cashier', 'waiter'],
  discount: ['owner', 'manager'],
  approve: ['owner', 'manager', 'accountant'],
  override: ['owner', 'manager'],
  stock: ['owner', 'manager', 'storekeeper', 'accountant'],
  count: ['owner', 'manager', 'storekeeper'],
  purchase: ['owner', 'manager', 'storekeeper', 'accountant'],
  money: ['owner', 'manager', 'accountant'],
  report: ['owner', 'manager', 'accountant'],
  setup: ['owner', 'manager'],
  admin: ['owner'],
  hr: ['owner', 'manager', 'accountant'],
  payroll: ['owner', 'accountant'],
  hotel: ['owner', 'manager', 'cashier', 'waiter'],
  housekeeping: ['owner', 'manager', 'storekeeper', 'cashier', 'waiter'],
  read: ['owner', 'manager', 'accountant', 'storekeeper', 'cashier', 'waiter'],
};
export const can = (role: Role, perm: string) => (P[perm] || []).includes(role);
