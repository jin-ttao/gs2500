// rAF timestamps can precede performance.now() read during the same frame.
export function frameDelta(now,previous){
  if(!Number.isFinite(now)||!Number.isFinite(previous))return 0;
  return Math.max(0,Math.min((now-previous)/1000,.08));
}
