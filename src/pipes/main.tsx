/**
 * CHIMERA PIPES entry: compile the band engine (wasm) first, then mount the UI. The page shares
 * CHIMERA's fonts, palette and screen components; only the instrument is new.
 */
import "../ui/styles.css";
import "./pipes.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initPipes, audio } from "./audio.ts";

const root = document.getElementById("root")!;

async function boot(): Promise<void> {
  try {
    await initPipes();
  } catch (err) {
    root.replaceChildren();
    const box = document.createElement("div");
    box.className = "boot-error";
    const msg = document.createElement("p");
    msg.textContent = `The pipes engine could not load: ${err instanceof Error ? err.message : String(err)}`;
    const retry = document.createElement("button");
    retry.className = "primary";
    retry.textContent = "Try again";
    retry.onclick = () => void boot();
    box.append(msg, retry);
    root.append(box);
    return;
  }
  const { App } = await import("./App.tsx");
  (window as unknown as { __pipes: typeof audio }).__pipes = audio;
  root.replaceChildren();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
