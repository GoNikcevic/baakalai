/* ===============================================================================
   BAAKALAI · Marque
   Source unique du logo : le symbole synapse et le bloc marque complet
   (symbole + mot). Avant ce composant, trois logos différents cohabitaient :
   la barre latérale affichait la synapse, l'écran de connexion et celui de
   réinitialisation un carré noir avec un « b » et le mot coupé en « baakal.ai ».
   Les couleurs du symbole sont littérales et non des tokens : le logo ne change
   pas entre le thème clair et le thème sombre, c'est la même marque.
   =============================================================================== */

export function BrandMark({ size = 22, className, title = 'baakalai' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      style={{ flexShrink: 0 }}
    >
      <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" />
      <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round" />
      <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" />
      <circle cx="22" cy="26" r="7" fill="#C4B5FD" />
      <circle cx="82" cy="30" r="8" fill="#9A84EB" />
      <circle cx="30" cy="80" r="7" fill="#C4B5FD" />
      <circle cx="50" cy="50" r="13" fill="#6E57FA" />
    </svg>
  );
}

/* Bloc marque : symbole + mot. Le mot s'écrit « baakalai », en un seul morceau,
   comme sur la landing et dans la barre latérale. */
export function BrandLockup({ size = 22, fontSize = 16, gap = 8, glow = false }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {glow ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size * 1.9,
            height: size * 1.9,
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
          }}
        >
          <BrandMark size={size} className="brand-logo" />
        </span>
      ) : (
        <BrandMark size={size} className="brand-logo" />
      )}
      <span className="brand-text" style={{ fontSize }}>baakalai</span>
    </span>
  );
}

export default BrandMark;
