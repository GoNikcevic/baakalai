import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  highlightVars,
  stripEditorHtml,
  getPlainTextLength,
  syncCampaignsFromContext,
  CH_ICONS,
  CH_LABELS,
} from '../editor-helpers';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('highlightVars', () => {
  it('wraps {{varName}} in span.var', () => {
    const result = highlightVars('Hello {{firstName}}');
    expect(result).toBe('Hello <span class="var">{{firstName}}</span>');
  });

  it('handles multiple variables', () => {
    const result = highlightVars('{{firstName}} at {{companyName}}');
    expect(result).toContain('<span class="var">{{firstName}}</span>');
    expect(result).toContain('<span class="var">{{companyName}}</span>');
  });

  it('returns empty string for falsy input', () => {
    expect(highlightVars('')).toBe('');
    expect(highlightVars(null)).toBe('');
  });

  it('leaves text without variables unchanged', () => {
    expect(highlightVars('Hello world')).toBe('Hello world');
  });

  it('does not match malformed variables', () => {
    expect(highlightVars('{{}} or {{ space }}')).toBe('{{}} or {{ space }}');
  });
});

describe('stripEditorHtml', () => {
  it('converts <br> to newlines', () => {
    expect(stripEditorHtml('line1<br>line2')).toBe('line1\nline2');
    expect(stripEditorHtml('line1<br/>line2')).toBe('line1\nline2');
    expect(stripEditorHtml('line1<br />line2')).toBe('line1\nline2');
  });

  it('converts var spans back to {{var}}', () => {
    expect(stripEditorHtml('<span class="var">{{firstName}}</span>')).toBe('{{firstName}}');
  });

  it('removes other HTML tags', () => {
    expect(stripEditorHtml('<strong>bold</strong> text')).toBe('bold text');
  });

  it('handles combined HTML', () => {
    const html = 'Bonjour <span class="var">{{firstName}}</span>,<br>Comment allez-vous ?';
    expect(stripEditorHtml(html)).toBe('Bonjour {{firstName}},\nComment allez-vous ?');
  });

  it('decodes HTML entities', () => {
    expect(stripEditorHtml('&amp; &lt; &gt;')).toBe('& < >');
  });

  it('returns empty string for falsy input', () => {
    expect(stripEditorHtml('')).toBe('');
    expect(stripEditorHtml(null)).toBe('');
  });
});

describe('getPlainTextLength', () => {
  it('counts plain text length', () => {
    expect(getPlainTextLength('Hello')).toBe(5);
  });

  it('strips HTML and counts only text', () => {
    expect(getPlainTextLength('<span class="var">{{firstName}}</span>')).toBe('{{firstName}}'.length);
  });

  it('returns 0 for falsy input', () => {
    expect(getPlainTextLength('')).toBe(0);
    expect(getPlainTextLength(null)).toBe(0);
  });
});

describe('syncCampaignsFromContext', () => {
  const mockCampaigns = {
    'camp-1': {
      name: 'Test Campaign',
      channel: 'email',
      status: 'active',
      iteration: 3,
      position: 'DAF',
      sectorShort: 'Finance',
      size: '11-50',
      angle: 'Douleur client',
      tone: 'Pro decontracte',
      formality: 'Vous',
      sequence: [
        { id: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subType: 'Premier contact', subject: 'Hello {{firstName}}', body: 'Body text', maxChars: undefined },
        { id: 'E2', type: 'email', label: 'Email relance', timing: 'J+3', subType: 'Relance', subject: null, body: '{{companyName}} info' },
      ],
    },
  };

  it('converts context campaigns to editor format', () => {
    const result = syncCampaignsFromContext(mockCampaigns);
    expect(result['camp-1']).toBeDefined();
    expect(result['camp-1'].name).toBe('Test Campaign');
    expect(result['camp-1'].channel).toBe(CH_LABELS.email);
    expect(result['camp-1'].icon).toBe(CH_ICONS.email);
  });

  it('sets correct meta string for active campaigns', () => {
    const result = syncCampaignsFromContext(mockCampaigns);
    expect(result['camp-1'].meta).toBe('2 touchpoints · Iteration 3');
  });

  it('sets correct meta string for prep campaigns', () => {
    const prepCampaigns = {
      'camp-prep': { ...mockCampaigns['camp-1'], status: 'prep', sequence: [] },
    };
    const result = syncCampaignsFromContext(prepCampaigns);
    expect(result['camp-prep'].meta).toBe('0 touchpoints · En preparation');
  });

  it('builds params array filtering nulls', () => {
    const result = syncCampaignsFromContext(mockCampaigns);
    const params = result['camp-1'].params;
    expect(params.some((p) => p.l === 'Canal')).toBe(true);
    expect(params.some((p) => p.l === 'Taille')).toBe(true);
    expect(params.every((p) => p !== null)).toBe(true);
  });

  it('maps sequence touchpoints correctly', () => {
    const result = syncCampaignsFromContext(mockCampaigns);
    const tps = result['camp-1'].touchpoints;
    expect(tps).toHaveLength(2);
    expect(tps[0].id).toBe('E1');
    expect(tps[0].type).toBe('email');
    expect(tps[0].subject).toBe('Hello {{firstName}}');
    expect(tps[0].body).toBe('Body text');
    expect(tps[1].subject).toBeNull();
  });

  it('handles empty input', () => {
    expect(syncCampaignsFromContext({})).toEqual({});
  });

  it('handles linkedin channel', () => {
    const lkCampaigns = {
      'lk-1': { ...mockCampaigns['camp-1'], channel: 'linkedin' },
    };
    const result = syncCampaignsFromContext(lkCampaigns);
    expect(result['lk-1'].channel).toBe('LinkedIn');
    expect(result['lk-1'].icon).toBe(CH_ICONS.linkedin);
  });
});
