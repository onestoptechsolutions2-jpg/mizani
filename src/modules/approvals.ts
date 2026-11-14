import { PoolClient } from 'pg';
import { bad, conflict, forbidden, notFound, q1, qa } from '../db';
import { Ctx } from '../ledger';
import { executeVoid } from './sales';
import { approveTake, rejectTake, approveWastage, rejectWastage } from './inventory';
import { decideLeave } from './hr';

export const listApprovals = (c: PoolClient, status: string) =>
  qa(c, `select a.*, u.name requested_by_name from approvals a join users u on u.id=a.requested_by
    where ($1='all' or a.status=$1) order by a.created_at desc limit 200`, [status]);

export async function decide(x: Ctx, id: string, approve: boolean, reason?: string) {
  const a = await q1(x.c, 'select * from approvals where id=$1 for update', [id]);
  if (!a) throw notFound('Approval not found');
  if (a.status !== 'pending') throw conflict(`Already ${a.status}`);
  if (a.requested_by === x.userId) throw forbidden('You cannot approve your own request');
  if (approve) {
    if (a.kind === 'bill_void') await executeVoid(x, a.subject_id, a.payload.reason);
    else if (a.kind === 'stock_take') await approveTake(x, a.subject_id);
    else if (a.kind === 'wastage') await approveWastage(x, a.subject_id);
    else if (a.kind === 'leave') await decideLeave(x, a.subject_id, true);
  } else {
    if (a.kind === 'leave') await decideLeave(x, a.subject_id, false);
    if (a.kind === 'stock_take') await rejectTake(x.c, a.subject_id, x.userId);
    if (a.kind === 'wastage') await rejectWastage(x.c, a.subject_id);
  }
  await x.c.query('update approvals set status=$2, decided_by=$3, reason=$4, decided_at=now() where id=$1', [id, approve ? 'approved' : 'rejected', x.userId, reason ?? null]);
  return { status: approve ? 'approved' : 'rejected' };
}
