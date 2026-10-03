import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { DriveApp } from "../src/components/drive/DriveApp";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<DriveApp />);
