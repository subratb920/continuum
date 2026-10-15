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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
