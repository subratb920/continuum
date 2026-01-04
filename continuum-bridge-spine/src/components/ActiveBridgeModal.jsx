export default function ActiveBridgeModal({ onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>LAST BRIDGE</h2>

        <h4>Completed</h4>
        <p>✓ Add validation to UserService</p>

        <h4>Incomplete</h4>
        <p>• Write unit tests for edge cases</p>

        <h4>Not Touched</h4>
        <p>• Remove deprecated method</p>

        <h4>Next Concrete Step</h4>
        <p className="accent">→ Write unit tests for edge cases</p>

        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
