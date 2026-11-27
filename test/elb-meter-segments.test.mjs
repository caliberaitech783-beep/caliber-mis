import test from 'node:test';
import assert from 'node:assert/strict';
import {elbCardsNeedDuplicateReview,shareCardOperator} from '../shared/log-book-shared-shift.mjs';
const first={cardShift:'S2',employeeId:'7',caliberId:'CMPL20046',jobCardNo:'2527',openingHmr:13086.9,closingHmr:13090.6,totalWorkingHmr:3.7};
const second={...first,openingHmr:13090.6,closingHmr:13095.1,totalWorkingHmr:4.5};
test('D30 consecutive ELBs retain both original segments without a duplicate finding',()=>{
 const before=JSON.stringify([first,second]);
 assert.equal(shareCardOperator(first,second),true);
 assert.equal(elbCardsNeedDuplicateReview(first,second),false);
 assert.equal(elbCardsNeedDuplicateReview(second,first),false);
 assert.equal(JSON.stringify([first,second]),before);
 assert.equal(first.totalWorkingHmr+second.totalWorkingHmr,8.2);
});
test('identical, overlapping, missing and invalid evidence still requires duplicate review',()=>{
 for(const other of [first,{...second,cardShift:''},{...second,cardShift:'S1'},{...second,manualShift:'Day'},{...second,openingHmr:13090.5,totalWorkingHmr:4.6},{...second,jobCardNo:''},{...second,jobCardNo:'999'},{...second,openingHmr:''},{...second,closingHmr:13090.6},{...second,closingHmr:-1},{...second,totalWorkingHmr:8},{...second,operatorSplit:{secondOperatorId:'8'}}])assert.equal(elbCardsNeedDuplicateReview(first,other),true,JSON.stringify(other));
});
test('separate operators keep existing treatment; missing operator identity is not trusted',()=>{
 assert.equal(elbCardsNeedDuplicateReview(first,{...first,employeeId:'8',caliberId:'CMPL9999'}),false);
 // No identified operator is not evidence for accepting a segmented card.
 assert.equal(elbCardsNeedDuplicateReview({...first,employeeId:'',caliberId:''},{...second,employeeId:'',caliberId:''}),true);
});
