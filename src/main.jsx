import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import UserExcelImportEnhancer from "./components/UserExcelImportEnhancer.jsx";
import { auth } from "./api/client.js";
import "./styles.css";

function UserExcelImportBootstrap() {
  const [canManageUsers, setCanManageUsers] = useState(() => Boolean(auth.getCurrentUser()?.permissions?.includes("user:manage")));
  useEffect(() => {
    const sync = () => setCanManageUsers(Boolean(auth.getCurrentUser()?.permissions?.includes("user:manage")));
    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, []);
  return canManageUsers ? <UserExcelImportEnhancer /> : null;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <UserExcelImportBootstrap />
  </React.StrictMode>,
);
