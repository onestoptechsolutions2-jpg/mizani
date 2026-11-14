import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bad, cents, conflict, notFound, q1, qa } from '../db';
import { balanceOf, businessDate, Ctx, METHOD_ACCT, postJournal, setting } from '../ledger';
import { verifyApprover } from './sales';

const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

export async function createRoomType(x: Ctx, b: any) {
  if (!b.name) throw bad('Name is required');
  return q1(x.c, 'insert into room_types(name, rate, tax_rate_bp) values ($1,$2,$3) returning *', [b.name, cents(b.rate, 'rate', true), b.tax_rate_bp ?? 1600]);
}
export async function createRoom(x: Ctx, b: any) {
  if (!b.number || !(await q1(x.c, 'select 1 from room_types where id=$1', [b.room_type_id]))) throw bad('Room number and a valid room type are required');
  return q1(x.c, 'insert into rooms(number, room_type_id) values ($1,$2) returning *', [String(b.number), b.room_type_id]);
}
export const listRooms = (c: PoolClient) => qa(c, `select r.id, r.number, r.status, t.name room_type, t.rate,
  (select json_build_object('id', v.id, 'number', v.number, 'guest', p.name, 'check_out', v.check_out) from reservations v join parties p on p.id=v.guest_id where v.room_id=r.id and v.status='checked_in' limit 1) occupant
  from rooms r join room_types t on t.id=r.room_type_id order by r.number`);
export const listRoomTypes = (c: PoolClient) => qa(c, 'select * from room_types order by name');

export async function availability(c: PoolClient, from: string, to: string) {
  if (!isDate(from) || !isDate(to) || to <= from) throw bad('from and to must be dates, with to after from');
  return qa(c, `select t.id room_type_id, t.name, t.rate,
      (select count(*) from rooms r where r.room_type_id=t.id and r.status not in ('out_of_order','maintenance'))::int total,
      (select count(*) from reservations v where v.room_type_id=t.id and v.status in ('booked','checked_in') and v.check_in < $2::date and v.check_out > $1::date)::int reserved,
      ((select count(*) from rooms r where r.room_type_id=t.id and r.status not in ('out_of_order','maintenance')) -
       (select count(*) from reservations v where v.room_type_id=t.id and v.status in ('booked','checked_in') and v.check_in < $2::date and v.check_out > $1::date))::int available
    from room_types t order by t.name`, [from, to]);
}
async function roomFree(c: PoolClient, roomId: string, from: string, to: string, ignore?: string) {
  const r = await q1(c, "select 1 from reservations where room_id=$1 and status in ('booked','checked_in') and check_in < $3::date and check_out > $2::date and ($4::uuid is null or id <> $4)", [roomId, from, to, ignore ?? null]);
  return !r;
}
export async function createReservation(x: Ctx, b: any) {
  const { c } = x;
  if (!isDate(b.check_in) || !isDate(b.check_out) || b.check_out <= b.check_in) throw bad('Check-in and check-out dates are required, with check-out after check-in');
  const guest = await q1(c, "select * from parties where id=$1 and kind='customer'", [b.guest_id]);
  if (!guest) throw bad('Choose or add the guest (as a customer)');
  const t = await q1(c, 'select * from room_types where id=$1', [b.room_type_id]);
  if (!t) throw bad('Choose a room type');
  const av = (await availability(c, b.check_in, b.check_out)).find((a: any) => a.room_type_id === t.id);
  if (!av || av.available < 1) throw conflict(`No ${t.name} rooms are free for those dates`);
  if (b.room_id) {
    const rm = await q1(c, 'select * from rooms where id=$1 and room_type_id=$2', [b.room_id, t.id]);
    if (!rm) throw bad('That room is not of that type');
    if (!(await roomFree(c, rm.id, b.check_in, b.check_out))) throw conflict('That room is already reserved for those dates');
  }
  const n = await q1(c, "select 'R' || lpad(nextval('reservation_seq')::text, 5, '0') n");
  return q1(c, 'insert into reservations(number, guest_id, room_type_id, room_id, check_in, check_out, rate, adults, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',
    [n.n, guest.id, t.id, b.room_id ?? null, b.check_in, b.check_out, b.rate != null ? cents(b.rate, 'rate', true) : t.rate, b.adults ?? 1, b.notes ?? null, x.userId]);
}
export async function cancelReservation(x: Ctx, id: string) {
  const r = await q1(x.c, 'select * from reservations where id=$1 for update', [id]);
  if (!r) throw notFound('Reservation not found');
  if (r.status !== 'booked') throw conflict(`A ${r.status} reservation cannot be cancelled`);
  await x.c.query("update reservations set status='cancelled' where id=$1", [id]);
  return { ok: true };
}

async function postFolioCharge(x: Ctx, r: any, o: { kind: 'room' | 'extra'; description: string; gross: number; revenue: string; vatBp: number; date: string }) {
  const { c } = x;
  const levyBp = parseInt(await setting(c, 'levy_bp', '0'), 10) || 0;
  const denom = 10000 + o.vatBp + levyBp;
  const tax = Math.round((o.gross * o.vatBp) / denom), levy = Math.round((o.gross * levyBp) / denom), net = o.gross - tax - levy;
  const id = randomUUID();
  const jid = await postJournal(c, { date: o.date, source: 'folio_charge', sourceId: id, by: x.userId, memo: `${r.number} ${o.description}`,
    lines: [{ acct: '1130', dr: o.gross, party: r.guest_id }, { acct: o.revenue, cr: net }, { acct: '2100', cr: tax }, { acct: '2110', cr: levy }] });
  await c.query('insert into folio_charges(id, reservation_id, kind, description, amount, business_date, journal_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, r.id, o.kind, o.description, o.gross, o.date, jid, x.userId]);
  return id;
}
export async function folio(c: PoolClient, id: string) {
  const r = await q1(c, 'select v.*, p.name guest, t.name room_type, m.number room_number from reservations v join parties p on p.id=v.guest_id join room_types t on t.id=v.room_type_id left join rooms m on m.id=v.room_id where v.id=$1', [id]);
  if (!r) throw notFound('Reservation not found');
  const charges = await qa(c, 'select kind, description, amount, business_date from folio_charges where reservation_id=$1 order by created_at', [id]);
  const payments = await qa(c, 'select method, amount, created_at from folio_payments where reservation_id=$1 order by created_at', [id]);
  const balance = charges.reduce((s: number, x: any) => s + x.amount, 0) - payments.reduce((s: number, x: any) => s + x.amount, 0);
  return { ...r, charges, payments, balance };
}
const folioBalance = async (c: PoolClient, id: string) => (await folio(c, id)).balance as number;

export async function checkIn(x: Ctx, id: string, b: any) {
  const { c } = x;
  const r = await q1(c, 'select * from reservations where id=$1 for update', [id]);
  if (!r) throw notFound('Reservation not found');
  if (r.status !== 'booked') throw conflict(`This reservation is ${r.status}`);
  const roomId = b.room_id || r.room_id;
  if (!roomId) throw bad('Assign a room to check in');
  const room = await q1(c, 'select * from rooms where id=$1 for update', [roomId]);
  if (!room || room.room_type_id !== r.room_type_id && !b.allow_upgrade) throw bad('Choose a room of the booked type (or allow an upgrade)');
  if (room.status !== 'clean') throw conflict(`Room ${room.number} is ${room.status.replace('_', ' ')}`);
  if (!(await roomFree(c, roomId, r.check_in, r.check_out, r.id))) throw conflict('That room is reserved for someone else on those dates');
  await c.query("update rooms set status='occupied' where id=$1", [roomId]);
  await c.query("update reservations set status='checked_in', room_id=$2 where id=$1", [id, roomId]);
  return { room: room.number };
}
export async function postExtraCharge(x: Ctx, id: string, b: any) {
  const r = await q1(x.c, "select * from reservations where id=$1 and status='checked_in'", [id]);
  if (!r) throw conflict('Charges go on the folio of a guest who is checked in');
  if (!b.description) throw bad('Describe the charge');
  await postFolioCharge(x, r, { kind: 'extra', description: b.description, gross: cents(b.amount), revenue: b.revenue_account || '4020', vatBp: b.tax_rate_bp ?? 1600, date: await businessDate(x.c) });
  return { balance: await folioBalance(x.c, id) };
}
export async function folioPayment(x: Ctx, id: string, b: any) {
  const { c } = x;
  const r = await q1(c, "select * from reservations where id=$1 and status in ('booked','checked_in') for update", [id]);
  if (!r) throw conflict('Payments go on a booked or checked-in reservation');
  const method = b.method, amount = cents(b.amount);
  if (!['cash', 'mpesa', 'card', 'bank', 'deposit'].includes(method)) throw bad('Method must be cash, mpesa, card, bank or deposit');
  if (r.status === 'booked' && method !== 'deposit') {
    // money taken before arrival is a customer deposit (liability), not folio revenue
    const jid = await postJournal(c, { date: await businessDate(c), source: 'deposit', sourceId: randomUUID(), by: x.userId, memo: `deposit ${r.number}`, lines: [{ acct: METHOD_ACCT[method], dr: amount }, { acct: '2200', cr: amount, party: r.guest_id }] });
    return { deposit: true, journal_id: jid, deposit_balance: -(await balanceOf(c, '2200', r.guest_id)) };
  }
  if (r.status !== 'checked_in') throw conflict('Apply a deposit once the guest has checked in');
  const bal = await folioBalance(c, id);
  if (amount > bal) throw conflict(`The folio balance is only ${bal}`);
  if (method === 'deposit' && amount > -(await balanceOf(c, '2200', r.guest_id))) throw conflict('The guest does not have that much on deposit');
  const debit = method === 'deposit' ? { acct: '2200', dr: amount, party: r.guest_id } : { acct: METHOD_ACCT[method], dr: amount };
  const pid = randomUUID();
  const jid = await postJournal(c, { date: await businessDate(c), source: 'folio_payment', sourceId: pid, by: x.userId, memo: `${r.number} ${method}`, lines: [debit, { acct: '1130', cr: amount, party: r.guest_id }] });
  await c.query('insert into folio_payments(id, reservation_id, method, amount, journal_id, created_by) values ($1,$2,$3,$4,$5,$6)', [pid, id, method, amount, jid, x.userId]);
  return { balance: bal - amount };
}
// Night audit: posts one room charge per in-house guest for the open trading day. Safe to run twice.
export async function nightAudit(x: Ctx) {
  const { c } = x;
  const bd = await businessDate(c);
  const stays = await qa(c, "select v.*, t.tax_rate_bp from reservations v join room_types t on t.id=v.room_type_id where v.status='checked_in' for update of v");
  let posted = 0;
  for (const r of stays) {
    if (await q1(c, "select 1 from folio_charges where reservation_id=$1 and kind='room' and business_date=$2", [r.id, bd])) continue;
    if (r.rate > 0) await postFolioCharge(x, r, { kind: 'room', description: `Room night ${bd}`, gross: r.rate, revenue: '4100', vatBp: r.tax_rate_bp, date: bd });
    posted++;
  }
  return { business_date: bd, in_house: stays.length, posted };
}
export async function checkOut(x: Ctx, id: string, b: any) {
  const { c } = x;
  const r = await q1(c, 'select * from reservations where id=$1 for update', [id]);
  if (!r) throw notFound('Reservation not found');
  if (r.status !== 'checked_in') throw conflict(`This reservation is ${r.status}`);
  const bal = await folioBalance(c, id);
  if (bal < 0) throw conflict('The guest has overpaid. Refund the difference before checking out.');
  if (bal > 0) {
    if (!b.transfer_to_debtors) throw conflict(`The folio still owes ${bal}. Take payment, or move it to the guest's account with a manager's approval.`);
    const approver = await verifyApprover(c, b.approver, x.userId);
    const pid = randomUUID();
    const jid = await postJournal(c, { date: await businessDate(c), source: 'folio_transfer', sourceId: pid, by: x.userId, memo: `${r.number} moved to guest account (approved)`,
      lines: [{ acct: '1100', dr: bal, party: r.guest_id }, { acct: '1130', cr: bal, party: r.guest_id }] });
    await c.query("insert into folio_payments(id, reservation_id, method, amount, journal_id, created_by) values ($1,$2,'transfer',$3,$4,$5)", [pid, id, bal, jid, approver]);
  }
  await c.query("update reservations set status='checked_out' where id=$1", [id]);
  await c.query("update rooms set status='dirty' where id=$1", [r.room_id]);
  return { checked_out: true, moved_to_account: bal };
}
export async function setRoomStatus(c: PoolClient, id: string, status: string) {
  const room = await q1(c, 'select * from rooms where id=$1 for update', [id]);
  if (!room) throw notFound('Room not found');
  if (!['clean', 'dirty', 'out_of_order', 'maintenance'].includes(status)) throw bad('Status must be clean, dirty, out_of_order or maintenance. Occupied is set by check-in.');
  if (room.status === 'occupied') throw conflict('The room is occupied. Check the guest out first.');
  await c.query('update rooms set status=$2 where id=$1', [id, status]);
  return { ok: true };
}
export const listReservations = (c: PoolClient, status?: string) => qa(c, `select v.id, v.number, v.status, v.check_in, v.check_out, v.rate, p.name guest, t.name room_type, m.number room_number
  from reservations v join parties p on p.id=v.guest_id join room_types t on t.id=v.room_type_id left join rooms m on m.id=v.room_id
  where ($1::text is null or v.status=$1) order by v.check_in desc limit 200`, [status ?? null]);
export async function occupancy(c: PoolClient, date: string) {
  if (!isDate(date)) throw bad('date must be YYYY-MM-DD');
  const total = (await q1(c, "select count(*)::int n from rooms where status not in ('out_of_order','maintenance')")).n;
  const occ = (await q1(c, "select count(*)::int n from reservations where status in ('checked_in','checked_out') and check_in <= $1::date and check_out > $1::date", [date])).n;
  const rev = (await q1(c, "select coalesce(sum(amount),0)::bigint r from folio_charges where kind='room' and business_date=$1", [date])).r;
  return { date, rooms_available: total, rooms_occupied: occ, occupancy_percent: total ? Math.round((occ * 1000) / total) / 10 : 0, room_revenue: rev, average_rate: occ ? Math.round(rev / occ) : 0 };
}
