import { useEffect, useState } from 'react';

const COLORS = ['#6C5CE7', '#00D68F', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'];

function ConfettiPiece({ index }) {
  const color = COLORS[index % COLORS.length];
  const left = Math.random() * 100;
  const delay = Math.random() * 0.5;
  const duration = 1.5 + Math.random() * 1;
  const size = 6 + Math.random() * 6;
  const rotation = Math.random() * 360;

  return (
    <div style={{
      position: 'fixed',
      left: `${left}%`,
      top: -20,
      width: size,
      height: size * 0.6,
      background: color,
      borderRadius: 2,
      transform: `rotate(${rotation}deg)`,
      animation: `confettiFall ${duration}s ease-in ${delay}s forwards`,
      zIndex: 99999,
      pointerEvents: 'none',
    }} />
  );
}

export default function Confetti({ trigger }) {
  const [pieces, setPieces] = useState([]);

  useEffect(() => {
    if (trigger) {
      setPieces(Array.from({ length: 50 }, (_, i) => i));
      const timer = setTimeout(() => setPieces([]), 3000);
      return () => clearTimeout(timer);
    }
  }, [trigger]);

  if (pieces.length === 0) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 99999 }}>
      {pieces.map(i => <ConfettiPiece key={i} index={i} />)}
    </div>
  );
}
