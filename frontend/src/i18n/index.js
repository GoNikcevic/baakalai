/**
 * Minimal i18n system for Baakalai.
 * Two languages: FR (default) and EN.
 *
 * Usage in components:
 *   import { useT } from '../i18n';
 *   const t = useT();
 *   <button>{t('auth.login')}</button>
 *   <span>{t('campaigns.revealEmails', { count: 10 })}</span>
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import fr from './fr.json';
import en from './en.json';

const translations = { fr, en };
const I18nContext = createContext({ lang: 'fr', setLang: () => {}, t: (k) => k });

/**
 * Get a nested value from an object by dot-separated key.
 * e.g. resolve(obj, 'auth.login') → obj.auth.login
 */
function resolve(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

/**
 * Replace {placeholders} in a string with values from a params object.
 * e.g. interpolate("Reveal {count} emails", { count: 10 }) → "Reveal 10 emails"
 */
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (_, key) => (params[key] !== undefined ? params[key] : `{${key}}`));
}

/**
 * Provider component — wrap your app with this.
 * Reads initial language from localStorage or browser locale.
 */
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    // Priority: localStorage > browser locale > default 'fr'
    const stored = localStorage.getItem('baakalai_lang');
    if (stored && translations[stored]) return stored;
    const browser = navigator.language?.slice(0, 2);
    if (browser === 'en') return 'en';
    return 'fr';
  });

  const setLang = useCallback((newLang) => {
    if (translations[newLang]) {
      setLangState(newLang);
      localStorage.setItem('baakalai_lang', newLang);
    }
  }, []);

  // Also update if the user's profile language changes (loaded async)
  useEffect(() => {
    const stored = localStorage.getItem('baakalai_lang');
    if (stored && translations[stored] && stored !== lang) {
      setLangState(stored);
    }
  }, []);

  const t = useCallback((key, params) => {
    const val = resolve(translations[lang], key) || resolve(translations.fr, key) || key;
    return interpolate(val, params);
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * Hook to access the translation function.
 * Returns t(key, params?) — resolves the key and interpolates placeholders.
 */
export function useT() {
  return useContext(I18nContext).t;
}

/**
 * Hook to access the full i18n context (lang, setLang, t).
 */
export function useI18n() {
  return useContext(I18nContext);
}

export default I18nContext;
