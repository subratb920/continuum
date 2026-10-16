import { Link } from "react-router-dom";
import { copyrightLine, FOOTER_NOTE } from "./legalText";
import "./Legal.css";

/**
 * The footer on every screen of Continuum (rendered once, under the app): one
 * slim line with the copyright and a link to the Legal page. Phones show the
 * short form.
 */
export default function LegalFooter() {
  return (
    <footer className="legal-footer">
      <p className="legal-footer-text">
        <span>{copyrightLine()}. All rights reserved.</span>
        <span className="legal-footer-note"> {FOOTER_NOTE}</span>
      </p>
      <Link to="/legal" className="legal-footer-link">
        Legal
      </Link>
    </footer>
  );
}
