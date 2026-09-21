import EditParamsPanel from '../EditParamsPanel';
import { InfoRow } from '../shared';
import { useI18n } from '../../../i18n';

export default function SettingsTab({ campaign: c, setCampaigns }) {
  const { lang } = useI18n(); const en = lang === 'en';
  return (
    <div>
      {/* Info card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div className="card-title">{en ? 'Campaign info' : 'ℹ️ Informations campagne'}</div>
        </div>
        <div className="card-body">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '24px',
            }}
          >
            <InfoRow label="Client" content={<strong>{c.client}</strong>} />
            <InfoRow label="Créée le" content={c.info?.createdDate || c.startDate} />
            <InfoRow
              label="Volume prévu"
              content={c.info?.volumeDesc || `${c.volume?.planned || 0} prospects`}
            />
            <InfoRow
              label="Canaux"
              content={
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {c.info?.channelsDesc || c.channelLabel}
                </span>
              }
            />
            <InfoRow label="Ton" content={c.tone} />
            <InfoRow label="Formalité" content={c.formality} />
          </div>
        </div>
      </div>

      {/* Inline edit panel · always visible in settings tab */}
      <EditParamsPanel campaign={c} setCampaigns={setCampaigns} onClose={() => {}} />
    </div>
  );
}
