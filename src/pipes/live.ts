/**
 * Each piper's live state for the screens, read from telemetry once per frame, and the air
 * moving through each set of pipes (shared by the band screen and the 3D view).
 */
import { emptyView, flowInput, readView, type PipeView } from "./render/bagpipe.ts";
import { Airflow, type FlowInput } from "./render/airflow.ts";

export const newInput = (): FlowInput => ({ bag: 0, bagOn: false, blow: 0, flows: [0, 0, 0, 0], note: 1, chAmp: 0 });

export const views: PipeView[] = [0, 1, 2, 3, 4].map(() => emptyView());
export const airs: Airflow[] = views.map(() => new Airflow(260));
const inputs = views.map(newInput);
let lastNow = -1;

/** Read every piper and move their air on to `now` (once per frame, however many screens ask). */
export function tickLive(now: number): void {
  if (now === lastNow) return;
  lastNow = now;
  for (let i = 0; i < views.length; i++) {
    readView(i, views[i]);
    airs[i].advance(now, flowInput(views[i], inputs[i]));
  }
}
