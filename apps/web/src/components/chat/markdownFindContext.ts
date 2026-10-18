import { createContext } from "react";

/** Exposes folded Markdown while finding; closing restores local disclosure choices. */
export const MarkdownFindContext = createContext(false);
