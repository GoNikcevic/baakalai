/* ===============================================================================
   BAKAL — Toast Container (React)
   Renders toast notifications from NotificationContext.
   Uses existing CSS classes from index.css (.toast-container, .toast, etc.)
   =============================================================================== */

import { useNotifications } from '../context/NotificationContext';
import Icon from './Icon';

const ICON_MAP = {
  success: 'checkCircle',
  warning: 'alert',
  danger: 'close',
  info: 'info',
};

function Toast({ toast, onClose }) {
  const { id, type, title, message, duration, removing, createdAt } = toast;

  return (
    <div
      className={`toast ${type}${removing ? ' removing' : ''}`}
      style={{ position: 'relative' }}
    >
      <div className={`toast-icon ${type}`}><Icon name={ICON_MAP[type] || ICON_MAP.info} size={16} /></div>
      <div className="toast-content">
        {title && <div className="toast-title">{title}</div>}
        {message && <div className="toast-message">{message}</div>}
      </div>
      <button className="toast-close" onClick={() => onClose(id)}>&times;</button>
      {duration > 0 && (
        <div
          className="toast-progress"
          style={{
            width: '100%',
            animation: `toastProgress ${duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onClose={removeToast} />
      ))}
    </div>
  );
}
