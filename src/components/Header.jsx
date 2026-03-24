export default function Header({ connStatus, connLabel, theme, onToggleTheme }) {
  const dotColors = {
    online: "#34d399",
    connecting: "#fbbf24",
    error: "#f87171",
    init: "#556",
  };

  return (
    <header className="header">
      <div className="logo">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2L13 6H10.5V11H7.5V6H5L9 2Z" fill="white" />
          <path d="M3 10V15H15V10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M6 12.5H12" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h1>DropVault</h1>
      </div>
      <div className="status-bar">
        <div
          className="dot"
          style={{
            background: dotColors[connStatus],
            boxShadow:
              connStatus === "online"
                ? "0 0 6px #34d399"
                : connStatus === "connecting"
                  ? "0 0 6px #fbbf24"
                  : "none",
            animation: connStatus === "connecting" ? "pulse 1s infinite" : "none",
          }}
        />
        <span>{connLabel}</span>
      </div>
      <div style={{ marginLeft: 12 }}>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
    </header>
  );
}