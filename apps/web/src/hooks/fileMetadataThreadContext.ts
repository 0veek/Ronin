import { createContext } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

export const FileMetadataThreadContext = createContext<ScopedThreadRef | null>(null);
