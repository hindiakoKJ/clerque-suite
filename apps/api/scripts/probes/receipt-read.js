// Read receipt images with the DEPLOYED reader: the prompt, schema, provider,
// parser, matcher and pack derivation compiled under /app/apps/api/dist, on the
// model and location in service. Prints the header and every line the way the
// screen would get it, matched against a small stand-in ingredient list.
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/receipt-read.js \
//        apps/api/scripts/fixtures/receipts/till_receipt.jpg apps/api/scripts/fixtures/receipts/shopee_order.png
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const rp = require('/app/apps/api/dist/procure/receipt-parser.js');
const gp = require('/app/apps/api/dist/ai/providers/gemini.provider.js');
const gc = require('/app/apps/api/dist/ai/google-credentials.js');
const short = (e) => String(e && e.message || e).replace(/\s+/g, ' ').slice(0, 220);
const MATERIALS = [
  { id: 'm1', name: 'Fresh Milk', unit: 'ml', category: 'INGREDIENT', costPrice: 80 },
  { id: 'm2', name: 'Brown Sugar', unit: 'g', category: 'INGREDIENT', costPrice: 0.06 },
  { id: 'm3', name: 'Chicken breast', unit: 'g', category: 'INGREDIENT', costPrice: 0.19 },
  { id: 'm4', name: 'Egg', unit: 'pc', category: 'INGREDIENT', costPrice: 8 },
  { id: 'm5', name: 'All-purpose cream', unit: 'ml', category: 'INGREDIENT', costPrice: 0.2 },
  { id: 'm6', name: 'Pork belly', unit: 'g', category: 'INGREDIENT', costPrice: 0.32 },
];
const kindOf = (file) => /shopee|order/i.test(file) ? 'order_screen' : /delivery|\bdr\b|dr_/i.test(file) ? 'delivery_receipt' : 'receipt';
const kindText = { receipt: '', order_screen: 'This is a screenshot of an online order page. ', delivery_receipt: "This is a supplier's delivery receipt. " };
(async () => {
  const key = gc.readGoogleCredentials();
  const project = (process.env.GOOGLE_CLOUD_PROJECT || '').trim() || key.project_id;
  const location = (process.env.GOOGLE_CLOUD_LOCATION || '').trim() || 'global';
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  console.log('deployed: model=' + model + ' location=' + location + ' schema=' + (rp.RECEIPT_RESPONSE_SCHEMA ? 'yes' : 'MISSING'));
  const ai = new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials: key, projectId: project } });
  const files = process.argv.slice(2);
  if (files.length === 0) { console.log('usage: receipt-read.js <image> [image ...]'); process.exit(2); }
  for (const file of files) {
    const kind = kindOf(file);
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    const data = fs.readFileSync(file).toString('base64');
    const t0 = Date.now();
    const out = await gp.callGemini(ai, {
      model, systemPrompt: rp.promptFor(kind), maxTokens: 2500, responseSchema: rp.RECEIPT_RESPONSE_SCHEMA,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data } },
        { type: 'text', text: kindText[kind] + 'Read every purchased line and the header per the system prompt. JSON only.' },
      ] }],
    });
    console.log('### ' + file + ' (' + kind + ') ' + (Date.now() - t0) + 'ms in=' + out.inputTokens + ' out=' + out.outputTokens);
    let parsed = rp.parseReceiptJson(out.text);
    const applied = rp.spreadDiscount(parsed); parsed = applied.parsed;
    console.log('header:', JSON.stringify({ vendor: parsed.vendor, dateIso: parsed.dateIso, ref: parsed.referenceNumber, total: parsed.total, discount: parsed.discount, itemCount: parsed.itemCount, itemsRead: rp.itemsOnReceipt ? rp.itemsOnReceipt(parsed.lines) : null, note: applied.note }));
    for (const l of parsed.lines) {
      const m = l.kind === 'expense' ? { best: null } : rp.matchIngredient(l.description, MATERIALS);
      const pack = l.kind === 'expense' ? null : rp.derivePack(l, m.best ? m.best.material : null);
      console.log('  ' + JSON.stringify({ d: l.description, barcode: l.barcode, qty: l.quantity, unit: l.unit, each: l.unitPrice, total: l.lineTotal, kind: l.kind, match: m.best ? m.best.material.name : null, pack: pack && { packs: pack.packsBought, size: pack.packSize, cost: pack.packCost, ask: pack.needsPackSize }, note: pack && pack.note }));
    }
  }
})().catch((e) => { console.error('ERR ' + short(e)); process.exit(1); });
