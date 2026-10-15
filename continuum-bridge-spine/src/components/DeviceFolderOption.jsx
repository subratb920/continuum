import { canCreateFolders, NO_FOLDERS_NOTE } from "../utils/deviceFolder";
import "./DeviceFolderOption.css";

/**
 * "Create a folder on this device": off unless ticked. Greyed out (with why)
 * where the browser can't create folders. hint: what goes into the folder.
 */
export default function DeviceFolderOption({ checked, onChange, hint, disabled = false }) {
  const supported = canCreateFolders();
  return (
    <div className={`device-folder-option${supported ? "" : " is-unsupported"}`}>
      <label>
        <input type="checkbox" checked={supported && checked} disabled={!supported || disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>Create a folder on this device</span>
      </label>
      <p className="device-folder-hint">{supported ? hint : NO_FOLDERS_NOTE}</p>
    </div>
  );
}
