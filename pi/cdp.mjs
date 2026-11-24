// evaluate JS inside the Pi kiosk page through the ssh-tunnelled DevTools port
const expr = process.argv[2];
const list = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = list.find(t => t.type === "page" && (t.title === "Family Hub" || t.url.includes("kiosk=1")));
if (!page) { console.log("no hub page", list.map(t=>t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
const msg = await new Promise(r => ws.onmessage = e => r(JSON.parse(e.data)));
console.log(JSON.stringify(msg.result?.result?.value ?? msg.result?.exceptionDetails?.text ?? msg, null, 1));
ws.close();
