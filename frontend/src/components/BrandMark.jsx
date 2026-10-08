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
   comme sur la landing et dans la barre latérale.

   C'est le MOT qui est centré, pas le bloc entier. Le symbole sort du flux et
   se pose à sa gauche, donc il ne décale plus le mot vers la droite : centré
   comme un bloc, « baakalai » tombait à droite de l'axe de la carte en
   dessous, et l'écran paraissait de travers. Le symbole ne compte ni dans la
   largeur ni dans la hauteur du bloc, c'est voulu, et c'est aussi pour cela
   que les deux appelants le placent dans un en-tête en `text-align: center`
   et non dans une rangée en flex. */
export function BrandLockup({ size = 22, fontSize = 16, gap = 8, glow = false }) {
  const marque = glow ? (
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
  );

  return (
    <span style={{ display: 'inline-block', position: 'relative' }}>
      {/* `right: 100%` colle le symbole au bord gauche du mot, quelle que soit
          la largeur rendue : rien n'est codé en dur, un changement de police
          ou de `fontSize` ne décale pas l'écart. */}
      <span
        style={{
          position: 'absolute',
          right: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          marginRight: gap,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {marque}
      </span>
      <span className="brand-text" style={{ fontSize }}>baakalai</span>
    </span>
  );
}

export default BrandMark;
