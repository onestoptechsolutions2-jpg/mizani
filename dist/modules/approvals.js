"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listApprovals = void 0;
exports.decide = decide;
const db_1 = require("../db");
const sales_1 = require("./sales");
const inventory_1 = require("./inventory");
const hr_1 = require("./hr");
const listApprovals = (c, status) => (0, db_1.qa)(c, `select a.*, u.name requested_by_name from approvals a join users u on u.id=a.requested_by
    where ($1='all' or a.status=$1) order by a.created_at desc limit 200`, [status]);
exports.listApprovals = listApprovals;
async function decide(x, id, approve, reason) {
    const a = await (0, db_1.q1)(x.c, 'select * from approvals where id=$1 for update', [id]);
    if (!a)
        throw (0, db_1.notFound)('Approval not found');
    if (a.status !== 'pending')
        throw (0, db_1.conflict)(`Already ${a.status}`);
    if (a.requested_by === x.userId)
        throw (0, db_1.forbidden)('You cannot approve your own request');
    if (approve) {
        if (a.kind === 'bill_void')
            await (0, sales_1.executeVoid)(x, a.subject_id, a.payload.reason);
        else if (a.kind === 'stock_take')
            await (0, inventory_1.approveTake)(x, a.subject_id);
        else if (a.kind === 'wastage')
            await (0, inventory_1.approveWastage)(x, a.subject_id);
        else if (a.kind === 'leave')
            await (0, hr_1.decideLeave)(x, a.subject_id, true);
    }
    else {
        if (a.kind === 'leave')
            await (0, hr_1.decideLeave)(x, a.subject_id, false);
        if (a.kind === 'stock_take')
            await (0, inventory_1.rejectTake)(x.c, a.subject_id, x.userId);
        if (a.kind === 'wastage')
            await (0, inventory_1.rejectWastage)(x.c, a.subject_id);
    }
    await x.c.query('update approvals set status=$2, decided_by=$3, reason=$4, decided_at=now() where id=$1', [id, approve ? 'approved' : 'rejected', x.userId, reason ?? null]);
    return { status: approve ? 'approved' : 'rejected' };
}
