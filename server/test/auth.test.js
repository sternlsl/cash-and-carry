import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFromPayload } from '../index.js';

// These payloads stand in for what Google returns *after* signature
// verification. They exercise the school-account rules, which is the part this
// project owns; verifying the signature itself is google-auth-library's job.
const NYU = ['nyu.edu'];

function reject(payload, domains = NYU){
  try{
    accountFromPayload(payload, domains);
    assert.fail('expected the account to be rejected');
  }catch(err){
    assert.ok(err.status === 403, `expected 403, got ${err.status}: ${err.message}`);
    return err.message;
  }
}

test('accepts a school Workspace account', () => {
  const acct = accountFromPayload({
    sub: '12345', email: 'Dana@nyu.edu', email_verified: true, hd: 'nyu.edu', name: 'Dana Lopez'
  }, NYU);
  assert.equal(acct.sub, '12345');
  assert.equal(acct.email, 'dana@nyu.edu', 'email should be normalised to lowercase');
  assert.equal(acct.googleName, 'Dana Lopez');
});

test('rejects a personal gmail account', () => {
  const msg = reject({ sub: '1', email: 'someone@gmail.com', email_verified: true });
  assert.match(msg, /personal Google account/);
});

test('rejects a personal account whose address merely ends in the school domain', () => {
  // No `hd` means it is not a Workspace account, whatever the address says.
  // This is the case an email-suffix check would let through.
  reject({ sub: '1', email: 'imposter@nyu.edu', email_verified: true });
});

test('rejects a different school, even with a valid hd', () => {
  const msg = reject({ sub: '1', email: 'someone@columbia.edu', email_verified: true, hd: 'columbia.edu' });
  assert.match(msg, /columbia\.edu/);
});

test('rejects an unverified email address', () => {
  reject({ sub: '1', email: 'dana@nyu.edu', email_verified: false, hd: 'nyu.edu' });
});

test('rejects a payload with no email', () => {
  reject({ sub: '1', hd: 'nyu.edu' });
});

test('subdomain accounts need to be listed explicitly', () => {
  const payload = { sub: '1', email: 'dana@stern.nyu.edu', email_verified: true, hd: 'stern.nyu.edu' };
  reject(payload);                                              // not covered by nyu.edu alone
  const acct = accountFromPayload(payload, ['nyu.edu', 'stern.nyu.edu']);
  assert.equal(acct.email, 'dana@stern.nyu.edu');               // works once configured
});

test('hd wins over the address suffix', () => {
  // A Workspace account can carry an address outside its hosted domain; the
  // hosted domain is the claim Google vouches for, so that is what we trust.
  reject({ sub: '1', email: 'dana@nyu.edu', email_verified: true, hd: 'elsewhere.com' });
});

test('falls back to the given name when no full name is present', () => {
  const acct = accountFromPayload(
    { sub: '9', email: 'r@nyu.edu', email_verified: true, hd: 'nyu.edu', given_name: 'Rio' }, NYU);
  assert.equal(acct.googleName, 'Rio');
});
