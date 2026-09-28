// Which Gemini ids this Google project can actually serve, per location, and
// whether structured output works on them. Run inside the API container:
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/ai-models.js
//
// Known result (2026-09-28, project clerque-ai): every Gemini 3.x Flash id
// answers 404 from us-central1 and answers from `global`; 2.5 Flash answers
// from both and retires 16 Oct 2026. Hence GOOGLE_CLOUD_LOCATION=global.
const { GoogleGenAI } = require('@google/genai');
const gc = require('/app/apps/api/dist/ai/google-credentials.js');
const CANDIDATES = (process.env.PROBE_MODELS || 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite').split(',');
const major = (m) => Number((/^gemini-(\d+)/.exec(m) || [])[1] || 3);
const think = (m, level) => major(m) >= 3 ? { thinkingLevel: level || 'LOW', includeThoughts: false } : { thinkingBudget: 0, includeThoughts: false };
const short = (e) => String(e && e.message || e).replace(/\s+/g, ' ').slice(0, 170);
(async () => {
  const key = gc.readGoogleCredentials();
  const project = (process.env.GOOGLE_CLOUD_PROJECT || '').trim() || key.project_id;
  const mk = (location) => new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials: key, projectId: project } });
  console.log('project=' + project, 'env_location=' + (process.env.GOOGLE_CLOUD_LOCATION || '(unset)'), 'env_model=' + (process.env.GEMINI_MODEL || '(unset)'));
  for (const location of ['us-central1', 'global']) {
    const ai = mk(location);
    console.log('=== location ' + location + ' ===');
    try {
      const pager = await ai.models.list({ config: { queryBase: true, pageSize: 200 } });
      const names = []; for await (const m of pager) { const n = String(m.name || ''); if (/gemini/i.test(n)) names.push(n.replace(/^publishers\/google\/models\//, '')); }
      console.log('catalogue (' + names.length + '):', names.filter((n) => /flash|pro/.test(n)).sort().join(', '));
    } catch (e) { console.log('catalogue: ERR ' + short(e)); }
    for (const m of CANDIDATES) {
      const t0 = Date.now();
      try {
        const r = await ai.models.generateContent({ model: m, contents: 'Reply with the single word OK', config: { maxOutputTokens: 64, thinkingConfig: think(m) } });
        console.log('  ' + m + ': OK "' + String(r.text || '').trim().slice(0, 20) + '" ' + (Date.now() - t0) + 'ms  ver=' + (r.modelVersion || '?'));
      } catch (e) { console.log('  ' + m + ': ERR ' + short(e)); }
    }
  }
  // Structured output on the model in service, at the location in service.
  const ai = mk((process.env.GOOGLE_CLOUD_LOCATION || '').trim() || 'global');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const schema = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { description: { type: 'STRING' }, quantity: { type: 'NUMBER', nullable: true }, unitPrice: { type: 'NUMBER', nullable: true }, lineTotal: { type: 'NUMBER', nullable: true } }, required: ['description', 'quantity', 'unitPrice', 'lineTotal'] } } }, required: ['lines'] };
  try {
    const r = await ai.models.generateContent({ model, contents: 'Receipt lines: "MAGNOLIA FRESH MILK 1L  2 @ 89.00  178.00" and "CHICKEN BREAST 1.250 kg @ 195.00/kg 243.75". Return JSON.', config: { maxOutputTokens: 512, thinkingConfig: think(model), responseMimeType: 'application/json', responseSchema: schema } });
    console.log('structured ' + model + ': ' + String(r.text || '').replace(/\s+/g, ' ').slice(0, 260));
  } catch (e) { console.log('structured ' + model + ': ERR ' + short(e)); }
})().catch((e) => { console.error('ERR', short(e)); process.exit(1); });
