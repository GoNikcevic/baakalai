import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppProvider } from '../AppContext';
import { useApp } from '../useApp';

// Mock auth service
vi.mock('../../services/auth', () => ({
  isLoggedIn: () => false,
  getUser: () => null,
  getToken: () => null,
  getRefreshToken: () => null,
}));

// Mock api-client
vi.mock('../../services/api-client', () => ({
  // Les composants passent par request() pour les appels non typés ;
  // sans cette entrée, vitest rejette tout accès à l'export absent.
  request: vi.fn().mockResolvedValue({}),
  default: {
    checkHealth: vi.fn().mockResolvedValue(null),
  },
}));

// Test component that consumes the context
function ContextConsumer() {
  const ctx = useApp();
  return (
    <div>
      <div data-testid="campaigns">{JSON.stringify(ctx.campaigns)}</div>
      <div data-testid="projects">{JSON.stringify(ctx.projects)}</div>
      <div data-testid="globalKpis">{JSON.stringify(ctx.globalKpis)}</div>
      <div data-testid="backendAvailable">{String(ctx.backendAvailable)}</div>
      <div data-testid="user">{JSON.stringify(ctx.user)}</div>
      <div data-testid="hasInitData">{typeof ctx.initData}</div>
      <div data-testid="hasSetCampaigns">{typeof ctx.setCampaigns}</div>
      <div data-testid="hasSetUser">{typeof ctx.setUser}</div>
    </div>
  );
}

describe('AppContext', () => {
  it('provides default empty campaigns', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('campaigns').textContent).toBe('{}');
  });

  it('provides default empty projects', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('projects').textContent).toBe('{}');
  });

  it('provides default empty globalKpis', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('globalKpis').textContent).toBe('{}');
  });

  it('provides backendAvailable as false by default', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('backendAvailable').textContent).toBe('false');
  });

  it('provides user as null when not logged in', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('provides initData function', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('hasInitData').textContent).toBe('function');
  });

  it('provides setter functions', () => {
    render(
      <AppProvider>
        <ContextConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('hasSetCampaigns').textContent).toBe('function');
    expect(screen.getByTestId('hasSetUser').textContent).toBe('function');
  });

  it('throws error when useApp is used outside AppProvider', () => {
    // Suppress console.error for this test since React will log the error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<ContextConsumer />);
    }).toThrow('useApp() must be used inside <AppProvider>');

    consoleSpy.mockRestore();
  });
});
