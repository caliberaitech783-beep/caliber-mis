// The report builds a worker thread may run (report-build-pool.mjs), by name. Each takes plain data and returns plain data.
import {buildManpowerWeek,manpowerCellsOf} from '../rules/manpower-week.mjs';
import {attendanceWeekJson,attendanceAnswerJson} from '../rules/attendance-read.mjs';

export const REPORT_BUILDS={'manpower-week':buildManpowerWeek,'manpower-cells':manpowerCellsOf,'attendance-week':attendanceWeekJson,'attendance-answer':attendanceAnswerJson};
