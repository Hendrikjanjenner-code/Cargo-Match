import { createContext, useContext } from "react";

export const DemoEntryContext = createContext({
  startDemo: (personaId?: string) => {},
  loginReal: () => {},
});

export const useDemoEntry = () => useContext(DemoEntryContext);
