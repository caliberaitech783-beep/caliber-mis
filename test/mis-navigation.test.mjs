import test from 'node:test';import assert from 'node:assert/strict';import {requestedMisPage,misPageUrl} from '../src/mis-navigation.mjs';
test('Vehicle Log Book link resolves to its form, distinct from scanner review',()=>{assert.equal(requestedMisPage('?page=vehicle-log-book'),'Vehicle Log Book Options');assert.equal(requestedMisPage('?page=trip-scan'),'Trip Card Bulk Scan');assert.equal(requestedMisPage('?page=equipment-log-book'),'Equipment Log Book Options');assert.equal(requestedMisPage('?page=unknown'),'Dashboard');});
test('menu navigation updates the address and clears scan selection when leaving scanner',()=>{assert.equal(misPageUrl('http://127.0.0.1:4174/?page=trip-scan&batch=123&card=456&filter=review','Vehicle Log Book'),'/?page=vlb-manual');assert.equal(misPageUrl('http://127.0.0.1:4174/?page=vehicle-log-book','Trip Card Bulk Scan'),'/?page=trip-scan');assert.equal(misPageUrl('http://127.0.0.1:4174/?page=trip-scan&batch=123','Trip Card Bulk Scan'),'/?page=trip-scan&batch=123');assert.equal(misPageUrl('http://127.0.0.1:4174/?page=vehicle-log-book','Dashboard'),'/');});

test('manual routes open forms while parent links open the Manual/Scan chooser',()=>{assert.equal(requestedMisPage('?page=vlb-manual'),'Vehicle Log Book');assert.equal(requestedMisPage('?page=elb-manual'),'Equipment Log Book');assert.equal(misPageUrl('http://localhost:4174/','Vehicle Log Book Options'),'/?page=vehicle-log-book');});

test('permanent report routes preserve only a matching scan batch and clear card filters',()=>{
 assert.equal(requestedMisPage('?page=vlb-reports'),'VLB Reports');assert.equal(requestedMisPage('?page=elb-reports'),'ELB Reports');
 assert.equal(misPageUrl('https://pulse-ll.cmll.in/?page=trip-scan&batch=one&card=two&filter=review','VLB Reports'),'/?page=vlb-reports&batch=one');
 assert.equal(misPageUrl('https://pulse-ll.cmll.in/?page=vlb-reports&batch=one','Trip Card Bulk Scan'),'/?page=trip-scan&batch=one');
 assert.equal(misPageUrl('https://pulse-ll.cmll.in/?page=vlb-reports&batch=one','ELB Reports'),'/?page=elb-reports');
 assert.equal(misPageUrl('https://pulse-ll.cmll.in/?page=job-scan&batch=one','ELB Reports'),'/?page=elb-reports&batch=one');
});
