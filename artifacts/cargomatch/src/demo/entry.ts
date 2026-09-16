import { createContext, useContext } from "react";

export const DemoEntryContext = createContext({
  startDemo: () => {},
  loginReal: () => {},
});

export const useDemoEntry = () => useContext(DemoEntryContext);