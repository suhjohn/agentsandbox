import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "./lib/auth";
import { useAuth } from "./lib/auth";
import { queryClient, router } from "./router";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}

type RootElement = HTMLElement & { __reactRoot__?: Root };
const rootContainer = rootEl as RootElement;
const root = rootContainer.__reactRoot__ ?? createRoot(rootContainer);
rootContainer.__reactRoot__ = root;

function RouterApp() {
  const auth = useAuth();
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ auth }} />
    </QueryClientProvider>
  );
}

root.render(
  <React.StrictMode>
    <AuthProvider>
      <RouterApp />
    </AuthProvider>
  </React.StrictMode>,
);
