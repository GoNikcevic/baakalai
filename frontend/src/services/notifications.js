/* Toast notification system — bridges imperative calls to React NotificationContext */

let _reactShowToast = null;

/** Called by NotificationProvider to register the React showToast function */
export function registerReactToast(fn) {
  _reactShowToast = fn;
}

/** @deprecated Use useNotifications().showToast instead for new code */
export function showToast({ type = 'info', title, message, duration = 5000 }) {
  if (_reactShowToast) {
    _reactShowToast({ type, title, message, duration });
    return;
  }

  // Fallback to DOM-based toast if React context not yet mounted
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const iconMap = { success: '\u2705', warning: '\u26A0\uFE0F', danger: '\u274C', info: '\u2139\uFE0F' };
  const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.id = id;
  toast.style.position = 'relative';
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  toast.innerHTML = `
    <div class="toast-icon ${type}">${iconMap[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${esc(title)}</div>
      <div class="toast-message">${esc(message)}</div>
    </div>
    <button class="toast-close" onclick="document.getElementById('${id}')?.remove()">&times;</button>
    ${duration > 0 ? '<div class="toast-progress" style="width:100%;"></div>' : ''}
  `;

  container.appendChild(toast);

  if (duration > 0) {
    const bar = toast.querySelector('.toast-progress');
    if (bar) {
      bar.style.transitionDuration = duration + 'ms';
      requestAnimationFrame(() => { bar.style.width = '0%'; });
    }
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

// Keep setToastContainer for backwards compat but it's now a no-op when React is mounted
export function setToastContainer() {}
