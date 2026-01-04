import { useState } from "react";
import IntervalSetup from "./IntervalSetup";
import ActiveBridgeModal from "../components/ActiveBridgeModal";

export default function ReEntry() {
  const [showBridge, setShowBridge] = useState(true);

  return (
    <>
      {showBridge && (
        <ActiveBridgeModal onClose={() => setShowBridge(false)} />
      )}

      {!showBridge && <IntervalSetup />}
    </>
  );
}
