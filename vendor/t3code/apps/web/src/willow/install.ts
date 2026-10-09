// First import of main.tsx: Willow's bridge is in place before any module reads `window.desktopBridge`.
import { installWillowBridge } from "./bridge";

installWillowBridge();
