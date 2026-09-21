import ReactivationQueuePage from './ReactivationQueuePage';

export default function ClientsToUpsellPage() {
  return (
    <ReactivationQueuePage
      kind="auto_upsell"
      i18nNamespace="upsell"
      detailRouteBase="/clients-to-upsell"
    />
  );
}
