export default function StatBar({ stats }) {
  return (
    <div className="stats-grid">
      <div className="stat-box">
        <div className="stat-val">{stats.sent}</div>
        <div className="stat-lbl">files sent</div>
      </div>
      <div className="stat-box">
        <div className="stat-val">{stats.speed}</div>
        <div className="stat-lbl">speed</div>
      </div>
      <div className="stat-box">
        <div className="stat-val">{stats.total}</div>
        <div className="stat-lbl">total MB</div>
      </div>
    </div>
  );
}