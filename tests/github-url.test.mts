import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePullRequestUrl, refToUrl } from '../src/lib/github/url';

const ok = (input: string) => {
  const result = parsePullRequestUrl(input);
  assert.ok(result.ok, `expected ${input} to parse, got: ${result.ok ? '' : result.reason}`);
  return result.ref;
};

const fail = (input: string) => {
  const result = parsePullRequestUrl(input);
  assert.equal(result.ok, false, `expected ${input} to be rejected`);
  return result.ok ? '' : result.reason;
};

test('parses the canonical pull request URL', () => {
  assert.deepEqual(ok('https://github.com/axios/axios/pull/6539'), {
    owner: 'axios',
    repo: 'axios',
    number: 6539,
  });
});

test('tolerates the shapes people actually paste', () => {
  assert.deepEqual(ok('http://www.github.com/axios/axios/pull/6539/files').number, 6539);
  assert.equal(ok('github.com/axios/axios/pull/6539').owner, 'axios');
  assert.equal(ok('  https://github.com/axios/axios/pull/6539#discussion_r1  ').number, 6539);
  assert.equal(ok('https://github.com/axios/axios/pulls/6539').number, 6539);
  assert.equal(ok('axios/axios#6539').number, 6539);
  assert.equal(ok('axios/axios/pull/6539').number, 6539);
  assert.equal(ok('https://github.com/acme/repo.name/pull/7').repo, 'repo.name');
  assert.equal(ok('https://github.com/acme/repo.git/pull/7').repo, 'repo');
});

test('rejects non-GitHub hosts by name', () => {
  assert.match(fail('https://gitlab.com/a/b/pull/1'), /Only github\.com/);
  assert.match(fail('https://github.evil.com/a/b/pull/1'), /Only github\.com/);
});

test('rejects URLs that are not pull requests', () => {
  assert.match(fail('https://github.com/axios/axios'), /owner.*repo.*pull/i);
  assert.match(fail('https://github.com/axios/axios/issues/6539'), /owner.*repo.*pull/i);
  assert.match(fail('https://github.com/axios/axios/pull/'), /owner.*repo.*pull/i);
});

test('rejects bad numbers and bad names', () => {
  assert.match(fail('https://github.com/axios/axios/pull/abc'), /not a valid pull request number/);
  assert.match(fail('https://github.com/axios/axios/pull/0'), /not a valid pull request number/);
  assert.match(fail('https://github.com/-bad/repo/pull/1'), /not a valid GitHub owner/);
  // GitHub owners cannot contain dots; repositories can.
  assert.match(fail('https://github.com/dot.ted/repo/pull/1'), /not a valid GitHub owner/);
});

test('rejects empty and unparseable input', () => {
  assert.match(fail(''), /Enter a GitHub pull request URL/);
  assert.match(fail('   '), /Enter a GitHub pull request URL/);
});

test('round-trips back to a canonical URL', () => {
  assert.equal(
    refToUrl(ok('axios/axios#6539')),
    'https://github.com/axios/axios/pull/6539',
  );
});
