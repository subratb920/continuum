import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./theme/tokens.css"; // every colour, for every theme
import "./index.css";
import "./responsive.css";
import "./appearance.css";
import { applyAppearance } from "./utils/preferences";

applyAppearance(); // Settings → Appearance, before the first paint
import { AuthProvider } from "./state/authStore";
import LegalFooter from "./legal/LegalFooter";
import { ScreenProviders } from "./screens/ScreenProviders";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* Each screen's shared state (e.g. the brain), on every page: the agents carry on
            while you use the rest of Continuum, and the running interval shows them */}
        <ScreenProviders>
          <App />
        </ScreenProviders>
        {/* Every screen: the copyright line and the Legal page link */}
        <LegalFooter />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
