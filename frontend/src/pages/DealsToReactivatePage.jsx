import ReactivationQueuePage from './ReactivationQueuePage';

export default function DealsToReactivatePage() {
  return (
    <ReactivationQueuePage
      kind="deal_reactivation"
      i18nNamespace="dealsToReactivate"
      detailRouteBase="/deals-to-reactivate"
    />
  );
}
