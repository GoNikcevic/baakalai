export function SkeletonLine({ width = '100%', height = 14 }) {
  return (
    <div className="skeleton" style={{ width, height, borderRadius: 6 }} />
  );
}

export function SkeletonCard({ height = 120 }) {
  return (
    <div className="skeleton" style={{ width: '100%', height, borderRadius: 12 }} />
  );
}

export function SkeletonKpi() {
  return (
    <div className="kpi-card" style={{ padding: 18 }}>
      <SkeletonLine width="60%" height={10} />
      <div style={{ marginTop: 12 }}><SkeletonLine width="40%" height={24} /></div>
      <div style={{ marginTop: 8 }}><SkeletonLine width="80%" height={10} /></div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div className="kpi-grid">
        {Array.from({ length: 6 }, (_, i) => <SkeletonKpi key={i} />)}
      </div>
      <div className="section-grid" style={{ marginTop: 20 }}>
        <SkeletonCard height={200} />
        <SkeletonCard height={200} />
        <SkeletonCard height={200} />
        <SkeletonCard height={200} />
      </div>
    </div>
  );
}
