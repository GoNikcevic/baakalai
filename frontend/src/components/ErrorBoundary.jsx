import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);

    // Auto-reload once on stale chunk errors (happens after deploy)
    const isChunkError = error?.message?.includes('dynamically imported module')
      || error?.message?.includes('Failed to fetch')
      || error?.message?.includes('Loading chunk');
    const hasReloaded = sessionStorage.getItem('chunk_reload');

    if (isChunkError && !hasReloaded) {
      sessionStorage.setItem('chunk_reload', '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'system-ui, sans-serif',
          padding: 32, textAlign: 'center',
        }}>
          <h2 style={{ marginBottom: 12 }}>Une erreur est survenue</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 500, marginBottom: 20 }}>
            {this.state.error?.message || 'Erreur inconnue'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: 8,
              padding: '10px 24px', cursor: 'pointer', fontWeight: 600,
            }}
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
