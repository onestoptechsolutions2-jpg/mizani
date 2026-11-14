"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.can = void 0;
exports.hashSecret = hashSecret;
exports.verifySecret = verifySecret;
const crypto_1 = __importDefault(require("crypto"));
function hashSecret(s) {
    const salt = crypto_1.default.randomBytes(16).toString('hex');
    return `${salt}:${crypto_1.default.scryptSync(s, salt, 32).toString('hex')}`;
}
function verifySecret(s, stored) {
    if (!stored)
        return false;
    const [salt, hash] = stored.split(':');
    const h = crypto_1.default.scryptSync(s, salt, 32).toString('hex');
    return crypto_1.default.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}
const P = {
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
const can = (role, perm) => (P[perm] || []).includes(role);
exports.can = can;
