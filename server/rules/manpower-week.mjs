// One week of a weekly Manpower read (OT, Category, Reconciliation, Shift Performance, Equipment Wise): link the VLB trip
// handovers, build the week and keep only what its tab and the join use. It runs on a worker thread (report-build-pool.mjs)
// so a month of every site does not freeze card saving on the server's main thread; the result is the same either way.
// The cards and the masters may come as JSON text (rowsJson, mastersJson): handing one string to a worker costs the main
// thread about a third of copying 30,000 card objects (17 Nov 2026 measurement: 140 ms against 420 ms a week).
import {buildManpowerReport,trimManpowerWeek,manpowerCategoryCells} from './manpower-report.mjs';
import {linkVlbTripHandovers} from '../../shared/vlb-trip-handover.mjs';

export function buildManpowerWeek({rows,rowsJson,masters,mastersJson,attendance,batches,filters,view}){
 rows??=JSON.parse(rowsJson);masters??=JSON.parse(mastersJson);
 const vehicles=linkVlbTripHandovers(rows.filter(r=>r.book_type==='vehicle'));
 const report=buildManpowerReport({records:[...vehicles,...rows.filter(r=>r.book_type!=='vehicle')],attendance,...masters,batches,filters,parts:view==='ot'?'ot':'all'});
 return view==='ot'?report:trimManpowerWeek(report,view);
}
// The Manpower by Category counts of a month's card keys (JSON text of the joined weeks' details lines).
export const manpowerCellsOf=detailsJson=>manpowerCategoryCells(typeof detailsJson==='string'?JSON.parse(detailsJson):detailsJson);
