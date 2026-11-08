import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSessionLimitExceptions,sessionLimitForLogin,singleSessionEnforced,DEFAULT_SESSION_LIMIT} from '../server/services/session-concurrency.mjs';

test('every login holds one session unless named in the exception list',()=>{
  const env={};
  assert.equal(DEFAULT_SESSION_LIMIT,1);
  assert.equal(sessionLimitForLogin('anoop',{env}),1);
  assert.equal(sessionLimitForLogin('',{env}),1);
  assert.equal(sessionLimitForLogin(undefined,{env}),1);
});

test('Mohit Chadda keeps up to three simultaneous sessions, matched on login only',()=>{
  const env={};
  for(const login of ['mohitchadda','MOHITCHADDA',' MohitChadda '])assert.equal(sessionLimitForLogin(login,{env}),3);
  assert.equal(sessionLimitForLogin('mohitchadda2',{env}),1);
  assert.equal(sessionLimitForLogin('Mohit Chadda',{env}),1);
});

test('the exception list is configurable and bounded',()=>{
  const exceptions=parseSessionLimitExceptions('mohitchadda=3, Manishchadda:2;bad;nobody=0,huge=99');
  assert.deepEqual([...exceptions.entries()],[['mohitchadda',3],['manishchadda',2],['huge',10]]);
  assert.equal(sessionLimitForLogin('manishchadda',{env:{SESSION_LIMIT_EXCEPTIONS:'manishchadda=2'}}),2);
  assert.equal(sessionLimitForLogin('mohitchadda',{env:{SESSION_LIMIT_EXCEPTIONS:'manishchadda=2'}}),1);
  assert.equal(sessionLimitForLogin('mohitchadda',{exceptions,env:{}}),3);
});

test('SINGLE_SESSION_PER_LOGIN=0 switches the rule off for everyone',()=>{
  for(const value of ['0','false','off','OFF','no'])assert.equal(singleSessionEnforced({SINGLE_SESSION_PER_LOGIN:value}),false);
  for(const value of [undefined,'','1','true','on'])assert.equal(singleSessionEnforced({SINGLE_SESSION_PER_LOGIN:value}),true);
  assert.equal(sessionLimitForLogin('anoop',{env:{SINGLE_SESSION_PER_LOGIN:'0'}}),0);
  assert.equal(sessionLimitForLogin('mohitchadda',{env:{SINGLE_SESSION_PER_LOGIN:'0'}}),0);
});
