/**
 * Confirm Modal — replaces window.confirm() with a styled modal.
 * Usage: const confirm = useConfirm();
 *        if (await confirm('Delete this item?')) { ... }
 */

import { useState, useCallback, createContext, useContext } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback((message, { danger = false } = {}) => {
    return new Promise((resolve) => {
      setState({ message, danger, resolve });
    });
  }, []);

  const handleClose = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
          }}
          onClick={() => handleClose(false)}
        >
          <div
            style={{
              background: 'var(--bg-card, #fff)', borderRadius: 12, padding: '24px',
              maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', marginBottom: 20, whiteSpace: 'pre-wrap' }}>
              {state.message}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '6px 16px' }}
                onClick={() => handleClose(false)}
              >
                Cancel
              </button>
              <button
                className={`btn ${state.danger ? '' : 'btn-primary'}`}
                style={{
                  fontSize: 12, padding: '6px 16px',
                  ...(state.danger ? { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6 } : {}),
                }}
                onClick={() => handleClose(true)}
                autoFocus
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    // Fallback if not wrapped in ConfirmProvider
    return (msg) => Promise.resolve(window.confirm(msg));
  }
  return confirm;
}
