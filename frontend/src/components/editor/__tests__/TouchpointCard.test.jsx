import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TouchpointCard from '../TouchpointCard';

// Mock api-client
vi.mock('../../../services/api-client', () => ({
  default: {
    regenerateSequence: vi.fn(),
  },
}));

const emailTp = {
  id: 'E1',
  type: 'email',
  label: 'Email initial',
  timing: 'J+0 · Envoye a 247 prospects',
  subType: 'Angle douleur client',
  subject: '{{firstName}}, une question',
  body: 'Bonjour {{firstName}},\n\nTexte du message chez {{companyName}}.',
  suggestion: null,
};

const linkedinTp = {
  id: 'L1',
  type: 'linkedin',
  label: 'Note de connexion',
  timing: 'J+0 · Max 300 caracteres',
  subType: 'Premiere prise de contact',
  subject: null,
  body: '{{firstName}}, votre parcours m\'a interpelle.',
  maxChars: 300,
  suggestion: null,
};

const tpWithSuggestion = {
  ...emailTp,
  id: 'E3',
  suggestion: {
    label: 'Suggestion IA — Changer l\'angle',
    text: 'L\'angle est anxiogene. <strong>Proposition :</strong> "Autre approche" -> mieux.',
  },
};

const defaultProps = {
  backendAvailable: false,
  campaignData: {},
  activeCampaignKey: 'test-camp',
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onTouchpointUpdate: vi.fn(),
};

describe('TouchpointCard', () => {
  it('renders email touchpoint with subject and body', () => {
    render(<TouchpointCard tp={emailTp} {...defaultProps} />);

    expect(screen.getByText(/Email initial/)).toBeInTheDocument();
    expect(screen.getByText(/Angle douleur client/)).toBeInTheDocument();
    expect(screen.getByText(/J\+0/)).toBeInTheDocument();
    expect(screen.getByText('Objet')).toBeInTheDocument();
    expect(screen.getByText('Corps du message')).toBeInTheDocument();
  });

  it('renders linkedin touchpoint with Message label and char counter', () => {
    render(<TouchpointCard tp={linkedinTp} {...defaultProps} />);

    expect(screen.getByText('Message')).toBeInTheDocument();
    expect(screen.getByText(/\/ 300 caracteres/)).toBeInTheDocument();
  });

  it('does not render subject field for linkedin messages', () => {
    render(<TouchpointCard tp={linkedinTp} {...defaultProps} />);

    expect(screen.queryByText('Objet')).not.toBeInTheDocument();
  });

  it('renders touchpoint ID dot', () => {
    render(<TouchpointCard tp={emailTp} {...defaultProps} />);

    expect(screen.getByText('E1')).toBeInTheDocument();
  });

  it('renders action buttons', () => {
    render(<TouchpointCard tp={emailTp} {...defaultProps} />);

    expect(screen.getByText('Regenerer')).toBeInTheDocument();
    expect(screen.getByText('Dupliquer')).toBeInTheDocument();
    expect(screen.getByText('Supprimer')).toBeInTheDocument();
  });

  it('calls onDuplicate when clicking Dupliquer', () => {
    const onDuplicate = vi.fn();
    render(<TouchpointCard tp={emailTp} {...defaultProps} onDuplicate={onDuplicate} />);

    fireEvent.click(screen.getByText('Dupliquer'));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete when clicking Supprimer', () => {
    const onDelete = vi.fn();
    render(<TouchpointCard tp={emailTp} {...defaultProps} onDelete={onDelete} />);

    fireEvent.click(screen.getByText('Supprimer'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('highlights {{variables}} in body content', () => {
    const { container } = render(<TouchpointCard tp={emailTp} {...defaultProps} />);

    const varSpans = container.querySelectorAll('.var');
    expect(varSpans.length).toBeGreaterThan(0);
    expect(varSpans[0].textContent).toContain('{{');
  });

  it('renders AI suggestion when present', () => {
    render(<TouchpointCard tp={tpWithSuggestion} {...defaultProps} />);

    expect(screen.getByText(/Suggestion IA/)).toBeInTheDocument();
    expect(screen.getByText('Appliquer')).toBeInTheDocument();
    expect(screen.getByText('Ignorer')).toBeInTheDocument();
  });

  it('does not render suggestion when absent', () => {
    render(<TouchpointCard tp={emailTp} {...defaultProps} />);

    expect(screen.queryByText('Appliquer')).not.toBeInTheDocument();
    expect(screen.queryByText('Ignorer')).not.toBeInTheDocument();
  });

  it('dismisses suggestion when clicking Ignorer', () => {
    render(<TouchpointCard tp={tpWithSuggestion} {...defaultProps} />);

    fireEvent.click(screen.getByText('Ignorer'));

    // Suggestion should disappear
    expect(screen.queryByText(/Suggestion IA/)).not.toBeInTheDocument();
  });

  it('shows applied state when clicking Appliquer', () => {
    render(<TouchpointCard tp={tpWithSuggestion} {...defaultProps} />);

    fireEvent.click(screen.getByText('Appliquer'));

    expect(screen.getByText(/Suggestion appliquee/)).toBeInTheDocument();
    expect(screen.queryByText('Appliquer')).not.toBeInTheDocument();
  });

  it('shows offline message when regenerating without backend', async () => {
    render(<TouchpointCard tp={emailTp} {...defaultProps} backendAvailable={false} />);

    fireEvent.click(screen.getByText('Regenerer'));

    expect(screen.getByText('Regeneration en cours...')).toBeInTheDocument();
  });

  it('applies email dot style for email type', () => {
    const { container } = render(<TouchpointCard tp={emailTp} {...defaultProps} />);

    const dot = container.querySelector('.tp-dot.email');
    expect(dot).not.toBeNull();
  });

  it('applies linkedin dot style for linkedin type', () => {
    const { container } = render(<TouchpointCard tp={linkedinTp} {...defaultProps} />);

    const dot = container.querySelector('.tp-dot.linkedin');
    expect(dot).not.toBeNull();
  });
});
