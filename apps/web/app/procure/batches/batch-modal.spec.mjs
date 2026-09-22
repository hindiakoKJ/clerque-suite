/**
 * Run: cd apps/web && node --test app/procure/batches/batch-modal.spec.mjs
 *
 * The Record-a-batch dialog on a 1024x600 kitchen tablet: a prep with six
 * ingredients made it 625px tall, nothing scrolled, and Cancel / Record it fell
 * off the bottom. And its summary said "Adds 2,000 ml" with 1,900 typed in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const modal = page.slice(page.indexOf('function MakeBatchModal('));

test('the dialog is never taller than the screen: the body scrolls, the buttons stay', () => {
  assert.match(modal, /max-h-\[calc\(100dvh-2rem\)\] flex flex-col overflow-hidden/);
  assert.match(modal, /min-h-0 flex-1 overflow-y-auto/);
  // The button row sits outside the scrolling body.
  const body = modal.indexOf('min-h-0 flex-1 overflow-y-auto');
  const buttons = modal.indexOf('flex shrink-0 gap-2 border-t');
  assert.ok(body > 0 && buttons > body);
});

test('the summary says what was measured, when it was measured', () => {
  assert.match(modal, /const addsTotal = measuredNum > 0 \? measuredNum : n \* \(recipe\.batchYield \?\? 0\);/);
  assert.match(modal, /Adds \{addsTotal\.toLocaleString\('en-PH'\)\}/);
});
