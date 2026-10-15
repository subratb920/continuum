import React from "react";

function AppHeader() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginBottom: "24px",
      color: "var(--text-muted)"
    }}>
      <img src="/logo-symbol.png" alt="" height={20} />
      <span style={{ fontSize: 14 }}>Continuum Console</span>
    </div>
  );
}
export default AppHeader;