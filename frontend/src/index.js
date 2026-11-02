import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { IS_CIVR_DOMAIN } from "@/cloudivr/paths";

// CloudIVR has its own translations; only the other apps need the i18next bundle (~250 KB), so load it on demand.
const civr = IS_CIVR_DOMAIN || window.location.pathname.startsWith("/cloudivr");
const root = ReactDOM.createRoot(document.getElementById("root"));
(civr ? Promise.resolve() : import("@/i18n")).then(() => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
