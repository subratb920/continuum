import { useEffect, useRef, useState } from "react";
import { downloadProjectClone } from "../api";
import { canCreateFolders, createProjectFolder, filesOfTarball, NO_FOLDERS_NOTE, pickParentFolder, removeProjectFolder, writeFiles } from "../utils/deviceFolder";
import Tip from "./Tip";
import "./GithubMenu.css";

const MENU_WIDTH = 260;

/**
 * A project's GitHub icon: Open on GitHub, or Download from GitHub (a git
 * clone of its repository, written into a folder the user picks on this
 * computer, wherever the project was created). Nothing about the folder is
 * kept by Continuum.
 */
export default function GithubMenu({ project, icon }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null); // { busy, text, error, done }
  const [copied, setCopied] = useState(null); // true: copied; false: the clipboard was blocked
  const [pos, setPos] = useState(null); // where the menu sits on screen: below the icon, where it fits
  const wrap = useRef(null);
  const repo = project.githubRepoUrl.replace(/^https:\/\/github\.com\//, "");
  const canDownload = canCreateFolders();
  const cloneCommand = `git clone ${project.githubRepoUrl.replace(/\/+$/, "").replace(/(\.git)?$/, ".git")}`;

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (status?.busy) return;
      if (e.type === "keydown" ? e.key === "Escape" : !wrap.current?.contains(e.target)) setOpen(false);
    };
    // The menu is placed on screen, so it closes when the list scrolls or the window resizes
    const away = (e) => {
      if (!status?.busy && !wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open, status?.busy]);

  async function download() {
    // The folder first: browsers only open the picker straight after a click
    let parent;
    try {
      parent = await pickParentFolder();
    } catch (e) {
      return setStatus({ error: `The folder couldn't be opened: ${e.message}` });
    }
    if (!parent) return;
    let folder = null;
    try {
      setStatus({ busy: true, text: `Getting ${repo} from GitHub…` });
      const files = await filesOfTarball(await downloadProjectClone(project._id));
      folder = await createProjectFolder(parent, project.name);
      await writeFiles(folder.handle, files, (done, total) => setStatus({ busy: true, text: `Writing files… ${done} of ${total}` }));
      setStatus({ done: true, text: `Downloaded into ${parent.name}/${folder.name}/ as a git clone (origin: GitHub).` });
    } catch (e) {
      if (folder) await removeProjectFolder(parent, folder.name).catch(() => {});
      setStatus({ error: `${e.message || "The download didn't finish."} You can clone it with git instead (below).` });
    }
  }

  async function copyClone() {
    try {
      await navigator.clipboard.writeText(cloneCommand);
      setCopied(true);
      setTimeout(() => setCopied((c) => (c === true ? null : c)), 1500);
    } catch {
      setCopied(false); // clipboard blocked: the command is shown to copy by hand
    }
  }

  return (
    <span className="gh-menu" ref={wrap}>
      <Tip text="GitHub" detail={`Open or download ${repo}`}>
        <button
          type="button"
          className="project-icon-btn project-link"
          aria-label={`GitHub: ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            // Fixed on screen (the project pane would clip it): from the icon's left edge
            // rightwards when it fits there, otherwise ending at its right edge
            const r = e.currentTarget.getBoundingClientRect();
            const left = r.left + MENU_WIDTH + 8 <= window.innerWidth ? r.left : r.right - MENU_WIDTH;
            setPos({ top: r.bottom + 4, left: Math.max(8, left) });
            setOpen((o) => !o);
            setCopied(null);
            if (!status?.busy) setStatus(null);
          }}
        >
          {icon}
        </button>
      </Tip>
      {open && (
        <div className="gh-menu-list" style={pos ?? undefined} role="menu" aria-label={`GitHub: ${repo}`}>
          <a role="menuitem" className="gh-menu-item" href={project.githubRepoUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <span className="gh-menu-title">Open on GitHub</span>
            <span className="gh-menu-hint">{repo}</span>
          </a>
          <button role="menuitem" type="button" className="gh-menu-item" onClick={download} disabled={!canDownload || Boolean(status?.busy)}>
            <span className="gh-menu-title">Download from GitHub</span>
            <span className="gh-menu-hint">{canDownload ? "A git clone into a folder you choose on this computer" : NO_FOLDERS_NOTE}</span>
          </button>
          {/* Clone with git: the command to run anywhere, e.g. when the download doesn't work */}
          <button role="menuitem" type="button" className="gh-menu-item gh-clone" onClick={copyClone} aria-label={`Copy the clone command: ${cloneCommand}`}>
            <span className="gh-clone-head">
              <span className="gh-menu-title">Clone</span>
              <span className={`gh-clone-copy${copied ? " is-copied" : ""}`}>{copied ? "Copied ✓" : "Copy"}</span>
            </span>
            <code className="gh-clone-cmd">{cloneCommand}</code>
          </button>
          {copied === false && <p className="gh-menu-status is-error" role="status">Copying isn't allowed here: select the command above and copy it.</p>}
          {status && (
            <p className={`gh-menu-status${status.error ? " is-error" : status.done ? " is-done" : ""}`} role="status">
              {status.busy && <span className="gh-spinner" aria-hidden="true" />}
              {status.error ?? status.text}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
