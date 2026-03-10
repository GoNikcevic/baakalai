/* Toast notification system — used imperatively across the app */

let _toastCounter = 0
let _toastContainer = null

export function setToastContainer(el) {
  _toastContainer = el
}

export function showToast({ type = 'info', title, message, duration = 5000 }) {
  const container = _toastContainer || document.getElementById('toastContainer')
  if (!container) return

  const id = 'toast-' + (++_toastCounter)
  const iconMap = { success: '\u2705', warning: '\u26A0\uFE0F', danger: '\u274C', info: '\u2139\uFE0F' }

  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.id = id
  toast.style.position = 'relative'
  toast.innerHTML = `
    <div class="toast-icon ${type}">${iconMap[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="document.getElementById('${id}')?.remove()">&times;</button>
    ${duration > 0 ? '<div class="toast-progress" style="width:100%;"></div>' : ''}
  `

  container.appendChild(toast)

  if (duration > 0) {
    const bar = toast.querySelector('.toast-progress')
    if (bar) {
      bar.style.transitionDuration = duration + 'ms'
      requestAnimationFrame(() => { bar.style.width = '0%' })
    }
    setTimeout(() => {
      toast.classList.add('removing')
      setTimeout(() => toast.remove(), 300)
    }, duration)
  }
}
