/* ===============================================================================
   BAKAL · Nommer un déclencheur, au même endroit pour tout le monde

   Un déclencheur de signal se nomme par son type, un déclencheur CRM par son
   événement ET sa condition : « le deal passe à Gagné » et « le deal passe à
   Négociation » sont deux automatisations différentes, et une liste qui les
   afficherait toutes les deux « Le deal change de stage » serait illisible.

   Sans ce module, chaque écran retombait sur `signals.type.<clé>`, ce qui
   affiche la clé brute pour un événement CRM.
   =============================================================================== */

/** Le libellé court, pour une ligne de liste. */
export function triggerLabel(t, trig) {
  if (!trig) return '';
  if (trig.eventSource === 'crm_event') {
    const stages = trig.conditions?.toStages || [];
    if (trig.eventKey === 'deal_stage_changed' && stages.length > 0) {
      return t('automation.wizard.sentenceStageShort', { stages: stages.join(', ') });
    }
    return t(`automation.wizard.event.${trig.eventKey}`);
  }
  return t('automation.triggers.signalLabel', { type: t(`signals.type.${trig.eventKey}`) });
}

/** La phrase complète, celle de l'étape 0 de l'éditeur et du récapitulatif. */
export function triggerSentence(t, trig) {
  if (!trig) return '';
  if (trig.eventSource === 'crm_event') {
    const stages = trig.conditions?.toStages || [];
    if (trig.eventKey === 'deal_stage_changed' && stages.length > 0) {
      return t('automation.wizard.sentenceStage', { stages: stages.join(' ou ') });
    }
    return t(`automation.wizard.event.${trig.eventKey}`);
  }
  return t('automation.triggers.signalSub', { type: t(`signals.type.${trig.eventKey}`) });
}
