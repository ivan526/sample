import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import UserExcelImportEnhancer from "./components/UserExcelImportEnhancer.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <UserExcelImportEnhancer />
  </React.StrictMode>,
);
