/* ===============================================================================
   BAKAL · Catalogue des déclencheurs d'automatisation

   Vivait dans NurturePage.jsx, que l'écran d'Automatisation n'utilise plus :
   le catalogue sert au formulaire de règles comme aux libellés des stats.
   =============================================================================== */

export function getTriggerTypes(lang) {
  const en = lang === 'en';
  return [
    { value: 'deal_won', label: en ? 'Lead won' : 'Lead gagné', desc: en ? 'Welcome/onboarding email when a lead is won' : 'Email de bienvenue quand un lead est gagné', icon: 'award', defaultDays: 1, defaultName: en ? 'Welcome new client' : 'Bienvenue nouveau client' },
    { value: 'deal_stagnant', label: en ? 'Stagnant lead' : 'Lead stagnant', desc: en ? 'Follow up when a lead is inactive for X days' : 'Relancer quand un lead est inactif depuis X jours', icon: 'moon', defaultDays: 30, defaultName: en ? 'Stagnant lead follow-up' : 'Relance leads stagnants' },
    { value: 'inactive_contact', label: en ? 'Inactive contact' : 'Contact inactif', desc: en ? 'Re-engage a contact with no activity for X days' : 'Réengager un contact sans activité depuis X jours', icon: 'moon', defaultDays: 60, defaultName: en ? 'Re-engage inactive contacts' : 'Réactivation contacts inactifs' },
    { value: 'deal_lost', label: en ? 'Lead lost' : 'Lead perdu', desc: en ? 'Win-back email after a lost lead' : 'Email de suivi après un lead perdu', icon: 'heartOff', defaultDays: 14, defaultName: en ? 'Win-back lost leads' : 'Win-back leads perdus' },
    { value: 'onboarding_check', label: en ? 'Onboarding check' : 'Check onboarding', desc: en ? 'Check adoption X days after signing' : 'Vérifier la prise en main X jours après signature', icon: 'rocket', defaultDays: 7, defaultName: en ? 'Onboarding follow-up D+7' : 'Suivi onboarding J+7' },
    { value: 'renewal_reminder', label: en ? 'Renewal' : 'Renouvellement', desc: en ? 'Reminder X days before renewal date' : 'Rappel X jours avant la date de renouvellement', icon: 'bell', defaultDays: 30, defaultName: en ? 'Renewal reminder' : 'Rappel renouvellement' },
    // Le seul type qui ne s'ancre pas sur une date du CRM : il part de
    // churn_flagged_at (migration 109), la date où le score de churn a franchi
    // le seuil. « days » y est un délai de courtoisie, pas une ancienneté.
    { value: 'churn_risk', label: en ? 'Client at risk' : 'Client à risque', desc: en ? 'Reopen the dialogue when a client crosses the churn risk threshold' : 'Rouvrir le dialogue quand un client passe au-dessus du seuil de risque de départ', icon: 'churn', defaultDays: 0, defaultName: en ? 'Client at risk follow-up' : 'Relance clients à risque' },
    { value: 'upsell_opportunity', label: en ? 'Upsell opportunity' : 'Opportunité upsell', desc: en ? 'Suggest upgrade to active clients after X days' : 'Proposer un upgrade aux clients actifs depuis X jours', icon: 'trendingUp', defaultDays: 90, defaultName: en ? 'Upsell proposal' : 'Proposition upsell' },
    { value: 'feedback_request', label: en ? 'Feedback request' : 'Demande de feedback', desc: en ? 'Ask for feedback after X days' : 'Demander un retour d\'expérience après X jours', icon: 'message', defaultDays: 30, defaultName: en ? 'Testimonial request' : 'Demande de témoignage' },
    { value: 'newsletter_inactive', label: en ? 'Newsletter inactive' : 'Newsletter inactif', desc: en ? 'Re-engage contacts who never open newsletters (Salesforce/Fonteva)' : 'Réengager les contacts qui n\'ouvrent pas les newsletters (Salesforce/Fonteva)', icon: 'mail', defaultDays: 30, defaultName: en ? 'Newsletter re-engagement' : 'Réactivation newsletter' },
    { value: 'newsletter_engaged', label: en ? 'Newsletter engaged' : 'Newsletter engagé', desc: en ? 'Notify sales when contacts actively engage with newsletters (Salesforce/Fonteva)' : 'Alerter le commercial quand un contact engage avec les newsletters (Salesforce/Fonteva)', icon: 'flame', defaultDays: 30, defaultName: en ? 'Hot newsletter lead' : 'Lead chaud newsletter' },
  ];
}
