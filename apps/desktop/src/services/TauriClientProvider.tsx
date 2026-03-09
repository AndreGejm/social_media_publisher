import React, { createContext, useContext, type ReactNode } from "react";
import * as tauriClientFuncs from "./tauriClient";

export type TauriClient = typeof tauriClientFuncs;

const TauriClientContext = createContext<TauriClient | null>(null);

export function TauriClientProvider({
    client,
    children
}: {
    client: TauriClient;
    children: ReactNode;
}) {
    return (
        <TauriClientContext.Provider value={client}>
            {children}
        </TauriClientContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTauriClient(): TauriClient {
    const context = useContext(TauriClientContext);
    if (!context) {
        throw new Error("useTauriClient must be used within a TauriClientProvider");
    }
    return context;
}
