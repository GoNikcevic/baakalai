import { useState, useEffect, useRef } from 'react';

export default function AnimatedCounter({ value, duration = 800, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  const numValue = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : (value || 0);
  const isPercent = typeof value === 'string' && value.includes('%');

  useEffect(() => {
    if (!numValue || numValue === 0) {
      setDisplay(0);
      return;
    }

    let startTime = null;
    const startVal = 0;

    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (numValue - startVal) * eased);
      setDisplay(current);

      if (progress < 1) {
        ref.current = requestAnimationFrame(animate);
      }
    }

    ref.current = requestAnimationFrame(animate);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [numValue, duration]);

  if (!numValue && numValue !== 0) return <span>{value}</span>;

  return <span>{display}{isPercent ? '%' : suffix}</span>;
}
