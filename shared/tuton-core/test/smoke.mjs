import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulative, parasites } from '../src/gpa.js';
import { normPath, joinPath, parseLooseJson } from '../src/ai.js';
import { isPdfBytes } from '../src/pdf.js';

test('gpa: IPK Tuton+UAS 70/70 = A (4.00)', () => {
  const r = cumulative([{ id: 's1', label: 'S1', courses: [{ code: 'EKMA5102', name: 'X', sks: 3, tuton: 70, uas: 70 }] }]);
  assert.equal(r.ipk, 4);
  assert.equal(r.sks, 3);
});

test('gpa: parasit hanya point<3.0', () => {
  const p = parasites([{ code: 'A', name: 'a', sks: 3, tuton: 90, uas: 90 }, { code: 'B', name: 'b', sks: 3, tuton: 40, uas: 40 }]);
  assert.equal(p.length, 1);
  assert.equal(p[0].code, 'B');
});

test('ai: path custom gateway', () => {
  assert.equal(joinPath('https://nutaraline.co.uk/v1/', 'chat/completions'), 'https://nutaraline.co.uk/v1/chat/completions');
  assert.equal(normPath('', '/models'), '/models');
  const j = parseLooseJson('data: {"choices":[{"delta":{"content":"ha"}}]} \ndata: [DONE]');
  assert.match(JSON.stringify(j), /ha/);
});

test('pdf: header %PDF', () => {
  assert.equal(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), true);
  assert.equal(isPdfBytes(new Uint8Array([1, 2, 3, 4, 5])), false);
});
