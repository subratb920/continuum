import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import "./responsive.css";
import "./appearance.css";
import "./theme-dark.generated.css";
import "./theme-dark.css";
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
