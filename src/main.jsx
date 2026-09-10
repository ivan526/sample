import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import UserExcelImportEnhancer from "./components/UserExcelImportEnhancer.jsx";
import OrganizationExcelImportEnhancer from "./components/OrganizationExcelImportEnhancer.jsx";
import { auth } from "./api/client.js";
import "./styles.css";

function ExcelImportBootstrap() {
  const [canManageUsers, setCanManageUsers] = useState(() => Boolean(auth.getCurrentUser()?.permissions?.includes("user:manage")));
  const [isAdmin, setIsAdmin] = useState(() => auth.getCurrentUser()?.role === "ADMIN");

  useEffect(() => {
    const sync = () => {
      const user = auth.getCurrentUser();
      setCanManageUsers(Boolean(user?.permissions?.includes("user:manage")));
      setIsAdmin(user?.role === "ADMIN");
    };
    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, []);

  return <>
    {canManageUsers ? <UserExcelImportEnhancer /> : null}
    {isAdmin ? <OrganizationExcelImportEnhancer /> : null}
  </>;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <ExcelImportBootstrap />
  </React.StrictMode>,
);
