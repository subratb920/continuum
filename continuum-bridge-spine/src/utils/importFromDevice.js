/**
 * Import from device: a project folder chosen on this computer or phone
 * becomes a project. Its name comes from the package.json "name" or the
 * folder; its contents are the list of its files' paths and sizes (shown in
 * the project pane). The files themselves are never uploaded.
 *
 * Phones that can't pick folders (iPhone) pick files instead: a package.json
 * gives its name, any other file its name without the extension.
 */

/** Never part of a project's contents (dependencies, git, build output, secrets). */
const LEFT_OUT = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv)(\/|$)|(^|\/)\.env(\.[^/]*)?$/;
export const MAX_ENTRIES = 5000;

/** "@scope/my-app" → "my-app" */
function cleanPackageName(name) {
  return String(name).replace(/^@[^/]+\//, "").trim();
}

/** [path inside the folder, size] for every file worth listing, at most MAX_ENTRIES. */
function entriesOf(files, folder) {
  const entries = [];
  let truncated = false;
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const path = folder && rel.startsWith(`${folder}/`) ? rel.slice(folder.length + 1) : rel;
    if (!path || LEFT_OUT.test(path)) continue;
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    entries.push([path, f.size]);
  }
  return { entries, truncated };
}

/** { name, folder, from, contents } for the chosen files, or null when nothing usable was chosen. */
export async function projectFromFiles(fileList) {
  const files = [...(fileList ?? [])];
  if (!files.length) return null;

  const rel = (f) => f.webkitRelativePath || f.name;
  const folder = rel(files[0]).includes("/") ? rel(files[0]).split("/")[0] : null;
  const { entries, truncated } = entriesOf(files, folder);
  const contents = { folder: folder ?? "", entries, truncated };

  // package.json at the top of the folder (or a package.json picked on its own)
  const pkg = files.find((f) => {
    const parts = rel(f).split("/");
    return parts.at(-1) === "package.json" && parts.length <= 2;
  });
  if (pkg) {
    try {
      const json = JSON.parse(await pkg.text());
      if (json?.name) return { name: cleanPackageName(json.name), folder, from: `package.json in ${folder ?? "the chosen files"}`, contents };
    } catch {
      /* not readable as JSON: use the folder's name */
    }
  }
  if (folder) return { name: folder, folder, from: `folder ${folder}`, contents };
  const base = files[0].name.replace(/\.[^.]+$/, "");
  return base ? { name: base, folder: null, from: `file ${files[0].name}`, contents } : null;
}

/** The event that opens the console's Create Project window with a picked folder. */
export const IMPORT_EVENT = "continuum:import-from-device";

/**
 * Opens the device's folder picker (a file picker on phones that can't pick
 * folders); when something is picked, the console's Create Project window
 * opens with it. Call it from a click (browsers only open pickers then).
 * onBeforeOpen: e.g. go to the console first.
 */
export function importFromDevice(onPicked) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  input.style.display = "none";
  input.addEventListener("change", async () => {
    const picked = await projectFromFiles(input.files);
    input.remove();
    if (!picked) return;
    onPicked?.(picked);
    // After the console has rendered (it owns the window)
    setTimeout(() => window.dispatchEvent(new CustomEvent(IMPORT_EVENT, { detail: picked })), 0);
  });
  document.body.appendChild(input);
  input.click();
}

/** "2.4 MB", "830 B" */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 1024) return `${n ?? 0} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
