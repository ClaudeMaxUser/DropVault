export default function DisconnectModal({ open, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Disconnect</h3>
        <p>Are you sure you want to disconnect? This will stop any active transfer.</p>
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button className="btn" onClick={onCancel} style={{ marginRight: 8 }}>cancel</button>
          <button className="btn-danger" onClick={onConfirm}>disconnect</button>
        </div>
      </div>
    </div>
  );
}