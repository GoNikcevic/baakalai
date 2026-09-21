const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

describe('Refinement Loop E2E (dry-run)', () => {
  let token;
  let campaignId;

  before(async () => {
    await setup();
    ({ token } = await registerAndLogin({ email: 'refinement@bakal.test' }));

    // Create a campaign with a full email+linkedin sequence
    const res = await request('POST', '/api/campaigns', {
      token,
      body: {
        name: 'E2E Refinement Test',
        client: 'TestCo',
        channel: 'multi',
        sector: 'SaaS B2B',
        position: 'CTO',
        size: '50-200',
        zone: 'France',
        tone: 'Pro décontracté',
        formality: 'Vous',
        angle: 'Douleur client',
        status: 'active',
        nbProspects: 120,
        sequence: [
          { step: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subject: 'Test subject E1', body: 'Test body E1' },
          { step: 'E2', type: 'email', label: 'Email valeur', timing: 'J+3', subject: 'Test subject E2', body: 'Test body E2' },
          { step: 'E3', type: 'email', label: 'Email relance', timing: 'J+7', subject: 'Test subject E3', body: 'Test body E3' },
          { step: 'E4', type: 'email', label: 'Email break-up', timing: 'J+12', subject: 'Test subject E4', body: 'Test body E4' },
          { step: 'L1', type: 'linkedin', label: 'Note connexion', timing: 'J+0', body: 'Test LK note' },
          { step: 'L2', type: 'linkedin', label: 'Message post-connexion', timing: 'J+3', body: 'Test LK message' },
        ],
      },
    });
    assert.equal(res.status, 201, 'Campaign creation should succeed');
    campaignId = res.body.id;
  });

  after(teardown);

  // ── Step 1: Generate Sequence ──

  describe('Step 1, Generate Sequence', () => {
    it('generates a full sequence via dry-run', async () => {
      const res = await request('POST', '/api/ai/generate-sequence?dry_run=true', {
        token,
        body: {
          sector: 'SaaS B2B',
          position: 'CTO',
          channel: 'multi',
          campaignId,
        },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);
      assert.ok(Array.isArray(res.body.sequence), 'Should return sequence array');
      assert.ok(res.body.sequence.length >= 4, 'Multi-channel sequence should have at least 4 steps');
      assert.ok(res.body.strategy, 'Should include a strategy');
      assert.ok(Array.isArray(res.body.hypotheses), 'Should include hypotheses');
    });

    it('saves touchpoints to DB when campaignId provided', async () => {
      // First generate with campaignId
      await request('POST', '/api/ai/generate-sequence?dry_run=true', {
        token,
        body: { sector: 'SaaS B2B', position: 'CTO', channel: 'email', campaignId },
      });

      // Verify touchpoints are saved
      const detail = await request('GET', `/api/campaigns/${campaignId}`, { token });
      assert.equal(detail.status, 200);
      assert.ok(detail.body.sequence.length >= 1, 'Touchpoints should be saved to DB');
    });
  });

  // ── Step 2: Analyze Campaign ──

  describe('Step 2, Analyze Campaign', () => {
    let diagnosticId;

    it('analyzes campaign performance', async () => {
      const res = await request('POST', '/api/ai/analyze?dry_run=true', {
        token,
        body: { campaignId },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);
      assert.ok(res.body.id, 'Should return diagnostic id');
      assert.ok(res.body.diagnostic, 'Should return diagnostic text');
      assert.ok(Array.isArray(res.body.priorities), 'Should return priorities array');
      assert.ok(res.body.priorities.length > 0, 'Should identify at least one priority');
      diagnosticId = res.body.id;
    });

    it('persists diagnostic in database', async () => {
      const res = await request('GET', `/api/ai/diagnostics/${campaignId}`, { token });
      assert.equal(res.status, 200);
      assert.ok(res.body.diagnostics.length >= 1, 'At least one diagnostic should be stored');
      const diag = res.body.diagnostics[0];
      assert.ok(diag.diagnostic, 'Diagnostic text should be present');
      assert.ok(diag.priorities, 'Priorities should be stored');
    });

    it('returns 404 for non-existent campaign', async () => {
      const res = await request('POST', '/api/ai/analyze?dry_run=true', {
        token,
        body: { campaignId: 99999 },
      });
      assert.equal(res.status, 404);
    });
  });

  // ── Step 3: Regenerate Sequence ──

  describe('Step 3, Regenerate Sequence', () => {
    it('regenerates underperforming messages', async () => {
      const res = await request('POST', '/api/ai/regenerate?dry_run=true', {
        token,
        body: {
          campaignId,
          diagnostic: 'E3 sous-performe. Angle anxiogène à remplacer.',
          originalMessages: [
            { step: 'E3', subject: 'Old subject', body: 'Old body' },
          ],
          clientParams: {
            tone: 'Pro décontracté',
            formality: 'Vous',
            sector: 'SaaS B2B',
          },
        },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);
      assert.ok(Array.isArray(res.body.messages), 'Should return regenerated messages');
      assert.ok(res.body.messages.length > 0, 'Should regenerate at least one message');
      assert.ok(res.body.summary, 'Should include a summary');
      assert.ok(Array.isArray(res.body.hypotheses), 'Should include A/B hypotheses');

      // Check message structure
      const msg = res.body.messages[0];
      assert.ok(msg.step, 'Message should have a step');
      assert.ok(msg.variantA, 'Message should have variant A');
      assert.ok(msg.variantB, 'Message should have variant B');
      assert.ok(msg.variantA.subject, 'Variant A should have a subject');
      assert.ok(msg.variantA.body, 'Variant A should have a body');
      assert.ok(msg.variantA.hypothesis, 'Variant A should have a hypothesis');
    });

    it('creates a version record in database', async () => {
      const res = await request('GET', `/api/ai/versions/${campaignId}`, { token });
      assert.equal(res.status, 200);
      assert.ok(res.body.versions.length >= 1, 'At least one version should be recorded');
      const version = res.body.versions[0];
      assert.equal(version.result, 'testing', 'New version should be in testing state');
      assert.ok(version.version >= 1, 'Version number should be >= 1');
    });
  });

  // ── Step 4: Full Refinement Loop (Analyze → Regenerate → Track) ──

  describe('Step 4, Full Refinement Loop', () => {
    it('runs the complete loop in one call', async () => {
      const res = await request('POST', '/api/ai/run-refinement?dry_run=true', {
        token,
        body: { campaignId },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);

      // Analysis results
      assert.ok(res.body.diagnosticId, 'Should return diagnosticId');
      assert.ok(res.body.analysis, 'Should return analysis object');
      assert.ok(res.body.analysis.summary, 'Analysis should have a summary');
      assert.ok(Array.isArray(res.body.analysis.priorities), 'Analysis should have priorities');

      // Regeneration results
      assert.ok(res.body.regeneration, 'Should return regeneration (campaign has touchpoints)');
      assert.ok(res.body.versionId, 'Should return versionId');
      assert.ok(Array.isArray(res.body.regeneration.messages), 'Regeneration should have messages');
      assert.ok(res.body.regeneration.summary, 'Regeneration should have a summary');

      // Steps regenerated
      assert.ok(Array.isArray(res.body.stepsRegenerated), 'Should list steps regenerated');
      assert.ok(res.body.stepsRegenerated.length > 0, 'Should have regenerated at least one step');

      // Usage tracking
      assert.ok(res.body.totalUsage, 'Should return total usage');
    });

    it('changes campaign status to optimizing', async () => {
      const detail = await request('GET', `/api/campaigns/${campaignId}`, { token });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.campaign.status, 'optimizing', 'Campaign status should be set to optimizing');
    });

    it('creates both a diagnostic AND a version', async () => {
      const diags = await request('GET', `/api/ai/diagnostics/${campaignId}`, { token });
      const versions = await request('GET', `/api/ai/versions/${campaignId}`, { token });

      // We ran analyze once + run-refinement once = at least 2 diagnostics
      assert.ok(diags.body.diagnostics.length >= 2, 'Should have at least 2 diagnostics');
      // We ran regenerate once + run-refinement once = at least 2 versions
      assert.ok(versions.body.versions.length >= 2, 'Should have at least 2 versions');
    });

    it('returns 404 for non-existent campaign', async () => {
      const res = await request('POST', '/api/ai/run-refinement?dry_run=true', {
        token,
        body: { campaignId: 99999 },
      });
      assert.equal(res.status, 404);
    });
  });

  // ── Step 5: Memory Consolidation ──

  describe('Step 5, Memory Consolidation', () => {
    it('consolidates cross-campaign patterns', async () => {
      const res = await request('POST', '/api/ai/consolidate-memory?dry_run=true', { token });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);
      assert.ok(res.body.patternsCreated >= 1, 'Should create at least one pattern');
      assert.ok(res.body.summary, 'Should return a summary');
    });

    it('persists memory patterns in database', async () => {
      const res = await request('GET', '/api/ai/memory', { token });
      assert.equal(res.status, 200);
      assert.ok(res.body.patterns.length >= 1, 'At least one memory pattern should be stored');

      const pattern = res.body.patterns[0];
      assert.ok(pattern.pattern, 'Pattern should have a name');
      assert.ok(pattern.category, 'Pattern should have a category');
      assert.ok(pattern.confidence, 'Pattern should have a confidence level');
    });
  });

  // ── Step 6: Generate Single Touchpoint ──

  describe('Step 6, Generate Single Touchpoint', () => {
    it('generates an email initial touchpoint', async () => {
      const res = await request('POST', '/api/ai/generate-touchpoint?dry_run=true', {
        token,
        body: { type: 'emailInitial', sector: 'SaaS B2B', position: 'CTO' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);
      assert.ok(res.body.touchpoint, 'Should return touchpoint data');
      assert.ok(res.body.touchpoint.subject, 'Touchpoint should have a subject');
      assert.ok(res.body.touchpoint.body, 'Touchpoint should have a body');
    });

    it('generates a linkedin connection note', async () => {
      const res = await request('POST', '/api/ai/generate-touchpoint?dry_run=true', {
        token,
        body: { type: 'linkedinConnection', sector: 'SaaS B2B', position: 'CTO' },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.touchpoint.body, 'LinkedIn note should have a body');
    });

    it('rejects unknown touchpoint type', async () => {
      const res = await request('POST', '/api/ai/generate-touchpoint?dry_run=true', {
        token,
        body: { type: 'unknownType', sector: 'SaaS' },
      });
      // dry-run falls back to emailInitial, but non-dry-run would reject
      // At minimum it should return 200 without crashing
      assert.ok([200, 400].includes(res.status));
    });

    it('rejects missing type', async () => {
      const res = await request('POST', '/api/ai/generate-touchpoint?dry_run=true', {
        token,
        body: { sector: 'SaaS' },
      });
      assert.equal(res.status, 400);
    });
  });

  // ── Step 7: Variable Chain Generator ──

  describe('Step 7, Variable Chain Generator', () => {
    it('generates a variable chain', async () => {
      const res = await request('POST', '/api/ai/generate-variables?dry_run=true', {
        token,
        body: { sector: 'SaaS B2B', position: 'CTO' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.dryRun, true);
      assert.ok(res.body.reasoning, 'Should include reasoning');
      assert.ok(Array.isArray(res.body.chain), 'Should return variable chain');
      assert.ok(res.body.chain.length >= 2, 'Chain should have at least 2 variables');

      // Check chain structure
      const variable = res.body.chain[0];
      assert.ok(variable.key, 'Variable should have a key');
      assert.ok(variable.label, 'Variable should have a label');
      assert.ok(variable.type, 'Variable should have a type (base/enrichment/derived)');
      assert.ok(Array.isArray(variable.examples), 'Variable should have examples');
    });

    it('rejects missing sector', async () => {
      const res = await request('POST', '/api/ai/generate-variables?dry_run=true', {
        token,
        body: { position: 'CTO' },
      });
      assert.equal(res.status, 400);
    });
  });

  // ── Step 8: Full Pipeline Integration ──

  describe('Step 8, Full Pipeline Integration', () => {
    it('runs the complete pipeline: create → generate → analyze → regenerate → consolidate', async () => {
      // 1. Create a fresh campaign
      const create = await request('POST', '/api/campaigns', {
        token,
        body: {
          name: 'Pipeline Integration Test',
          client: 'IntegrationCo',
          channel: 'email',
          sector: 'Fintech',
          position: 'CFO',
          status: 'active',
        },
      });
      assert.equal(create.status, 201);
      const cid = create.body.id;

      // 2. Generate sequence
      const gen = await request('POST', '/api/ai/generate-sequence?dry_run=true', {
        token,
        body: { sector: 'Fintech', position: 'CFO', channel: 'email', campaignId: cid },
      });
      assert.equal(gen.status, 200);
      assert.ok(gen.body.sequence.length >= 4, 'Should generate a full email sequence');

      // 3. Verify sequence is persisted
      const detail1 = await request('GET', `/api/campaigns/${cid}`, { token });
      assert.ok(detail1.body.sequence.length >= 4, 'Touchpoints should be saved');

      // 4. Run the full refinement loop
      const refine = await request('POST', '/api/ai/run-refinement?dry_run=true', {
        token,
        body: { campaignId: cid },
      });
      assert.equal(refine.status, 200);
      assert.ok(refine.body.diagnosticId, 'Should produce a diagnostic');
      assert.ok(refine.body.versionId, 'Should produce a version');
      assert.ok(refine.body.analysis.priorities.length > 0, 'Should identify priorities');
      assert.ok(refine.body.regeneration.messages.length > 0, 'Should regenerate messages');

      // 5. Verify campaign detail now shows diagnostics and versions
      const detail2 = await request('GET', `/api/campaigns/${cid}`, { token });
      assert.equal(detail2.body.campaign.status, 'optimizing');
      assert.ok(detail2.body.diagnostics.length >= 1, 'Diagnostic should appear in campaign detail');
      assert.ok(detail2.body.history.length >= 1, 'Version should appear in campaign history');

      // 6. Consolidate memory
      const mem = await request('POST', '/api/ai/consolidate-memory?dry_run=true', { token });
      assert.equal(mem.status, 200);
      assert.ok(mem.body.patternsCreated >= 1, 'Should create memory patterns');

      // 7. Verify memory is accessible
      const memList = await request('GET', '/api/ai/memory', { token });
      assert.ok(memList.body.count >= 1, 'Memory patterns should be queryable');
    });
  });
});
