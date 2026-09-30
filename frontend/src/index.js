import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import "@/i18n";
import App from "@/App";
import { applyRuntimeBranding } from "@/branding";

const root = ReactDOM.createRoot(document.getElementById("root"));
const render = () =>
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

// Resolve the live brand (bot /api/branding) before first paint, then render.
// Never blocks longer than the fetch timeout; falls back to build-time brand.
applyRuntimeBranding().finally(render);
