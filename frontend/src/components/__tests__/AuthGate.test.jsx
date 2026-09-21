import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AuthGate from '../AuthGate';

// Mock auth service
vi.mock('../../services/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
}));

import { login, register } from '../../services/auth';

describe('AuthGate', () => {
  const mockOnAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form by default', () => {
    render(<AuthGate onAuth={mockOnAuth} />);

    expect(screen.getByText('Le système IA qui exploite ton CRM')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  });

  it('does not show name and company fields in login mode', () => {
    render(<AuthGate onAuth={mockOnAuth} />);

    expect(screen.queryByLabelText('Nom complet')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Entreprise/)).not.toBeInTheDocument();
  });

  it('toggles to register mode and shows additional fields', () => {
    render(<AuthGate onAuth={mockOnAuth} />);

    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));

    expect(screen.getByLabelText('Nom complet')).toBeInTheDocument();
    expect(screen.getByLabelText(/Entreprise/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer mon compte' })).toBeInTheDocument();
  });

  it('toggles back to login mode', () => {
    render(<AuthGate onAuth={mockOnAuth} />);

    // Go to register
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    expect(screen.getByLabelText('Nom complet')).toBeInTheDocument();

    // Go back to login
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.queryByLabelText('Nom complet')).not.toBeInTheDocument();
  });

  it('calls login on form submit in login mode', async () => {
    const fakeUser = { name: 'Test', email: 'test@test.com' };
    login.mockResolvedValue(fakeUser);

    render(<AuthGate onAuth={mockOnAuth} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => {
      // login() reçoit désormais un troisième argument : « se souvenir de moi ».
      expect(login).toHaveBeenCalledWith('test@test.com', 'password123', expect.any(Boolean));
      expect(mockOnAuth).toHaveBeenCalledWith(fakeUser);
    });
  });

  it('calls register on form submit in register mode', async () => {
    const fakeUser = { name: 'Goran', email: 'goran@test.com' };
    register.mockResolvedValue(fakeUser);

    render(<AuthGate onAuth={mockOnAuth} />);

    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));

    fireEvent.change(screen.getByLabelText('Nom complet'), { target: { value: 'Goran' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'goran@test.com' } });
    fireEvent.change(screen.getByLabelText(/Entreprise/), { target: { value: 'Stanko' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('Goran', 'goran@test.com', 'password123', 'Stanko');
    });

    // L'inscription ne connecte plus directement : elle affiche l'écran de
    // vérification par email. onAuth ne doit donc pas être appelé ici.
    expect(mockOnAuth).not.toHaveBeenCalled();
  });

  it('displays error message on login failure', async () => {
    login.mockRejectedValue(new Error('Invalid credentials'));

    render(<AuthGate onAuth={mockOnAuth} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad@test.com' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
    expect(mockOnAuth).not.toHaveBeenCalled();
  });

  it('shows loading state while submitting', async () => {
    let resolveLogin;
    login.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));

    render(<AuthGate onAuth={mockOnAuth} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(screen.getByText('Chargement...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chargement...' })).toBeDisabled();

    resolveLogin({ name: 'Test', email: 'test@test.com' });

    await waitFor(() => {
      expect(screen.queryByText('Chargement...')).not.toBeInTheDocument();
    });
  });

  it('renders the brand header', () => {
    render(<AuthGate onAuth={mockOnAuth} />);

    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('.ai')).toBeInTheDocument();
  });
});
