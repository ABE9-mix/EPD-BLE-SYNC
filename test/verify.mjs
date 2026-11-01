/**
 * 验证网页端的纯逻辑：分片、WMO 映射、payload 组装、need_sync 识别。
 * 不涉及 BLE（浏览器 API 在 Node 里没有），只跑可独立测试的函数。
 */
import fs from "node:fs";

const html = fs.readFileSync(process.argv[2], "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("FAIL: 找不到 script"); process.exit(1); }
const js = m[1];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}

// ---- 1. 抽出 wmoDesc 与 safeInt/safeDesc/byteLen 的实现单独测 ----
const fns = ["function wmoDesc", "function safeInt", "function safeDesc", "function byteLen"];
console.log("== 1. 函数存在性 ==");
for (const f of fns) check(f, js.includes(f));

// 构造一个最小沙箱，把需要的函数 + 依赖的常量表 eval 出来
const consts = js.match(/const WMO_DESC[\s\S]*?\n\};/);
const sandbox =
  (consts ? consts[0] : "") + "\n" +
  js.match(/function wmoDesc[\s\S]*?\n}/)[0] + "\n" +
  js.match(/function safeInt[\s\S]*?\n}/)[0] + "\n" +
  js.match(/function safeDesc[\s\S]*?\n}/)[0] + "\n" +
  js.match(/function byteLen[\s\S]*?\n}/)[0];

const ctx = {};
new Function("exports", sandbox + "\nexports.wmoDesc=wmoDesc;exports.safeInt=safeInt;exports.safeDesc=safeDesc;exports.byteLen=byteLen;")(ctx);

console.log("\n== 2. WMO 映射 (全部 <=16 字符且纯 ASCII) ==");
const codes = [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99];
let allOk = true;
for (const c of codes) {
  const d = ctx.wmoDesc(c);
  const okLen = typeof d === "string" && d.length > 0 && d.length <= 16;
  const okAscii = /^[\x20-\x7e]*$/.test(d);
  if (!okLen || !okAscii) { allOk = false; console.log(`  FAIL code=${c} -> "${d}"`); }
}
check(`全部 ${codes.length} 个 WMO 码映射合法`, allOk);

console.log("\n== 3. 未定义码的兜底 ==");
check("code=9999 有兜底", typeof ctx.wmoDesc(9999) === "string" && ctx.wmoDesc(9999).length > 0);
check("code=null 有兜底", typeof ctx.wmoDesc(null) === "string");

console.log("\n== 4. safeInt / safeDesc ==");
check("safeInt(21.7)=22", ctx.safeInt(21.7) === 22, String(ctx.safeInt(21.7)));
check("safeInt(null)=null", ctx.safeInt(null) === null);
check("safeInt(undefined)=null", ctx.safeInt(undefined) === null);
check("safeInt('')=null", ctx.safeInt("") === null);
check("safeInt(NaN)=null", ctx.safeInt(NaN) === null);
check("safeDesc 超长截断到<=16", ctx.safeDesc("A".repeat(40), "X").length <= 16);
check("safeDesc('')用兜底", ctx.safeDesc("", "Fallback") === "Fallback");

console.log("\n== 5. byteLen 中文按 UTF-8 字节数 ==");
check("byteLen('abc')=3", ctx.byteLen("abc") === 3);
check("byteLen('杭州')=6", ctx.byteLen("杭州") === 6, String(ctx.byteLen("杭州")));

console.log("\n== 6. 分片逻辑（复刻 writeChunked 的切分规则） ==");
function chunk(text, size = 180) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text + "\n");
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}
{
  const t = JSON.stringify({ temp: 23, desc: "Sunny" });
  const c = chunk(t);
  check("短载荷 1 片", c.length === 1, `${c.length} 片`);
  const joined = Buffer.concat(c.map(b => Buffer.from(b))).toString("utf8");
  check("拼回内容一致", joined === t + "\n");
}
{
  const t = JSON.stringify({ temp: 23, desc: "X".repeat(500) });
  const c = chunk(t);
  check("长载荷多片", c.length > 1, `${c.length} 片`);
  check("每片 <=180", c.every(b => b.length <= 180));
  const joined = Buffer.concat(c.map(b => Buffer.from(b))).toString("utf8");
  check("长载荷拼回一致", joined === t + "\n");
}

console.log("\n== 7. payload 必须带 epoch（用于校准设备时钟） ==");
check("buildPayload 含 epoch 字段", /payload\.epoch\s*=/.test(js));

console.log("\n== 8. 自动同步关键逻辑存在 ==");
const feats = [
  ["need_sync 识别", /parsed\.cmd === "need_sync"/],
  ["连上即同步", /startAutoSync\(\);\s*\n\s*syncWeather\(true\)/],
  ["定时器", /setInterval\(/],
  ["断线自动重连", /autoReconnect/],
  ["页面回前台补同步", /visibilitychange/],
  ["防并发", /if \(syncing\)/],
  ["下次同步时间显示", /refreshAutoNext/],
];
for (const [n, re] of feats) check(n, re.test(js));

console.log("\n== 9. need_sync 不会污染回执队列 ==");
check("need_sync 后 continue", /parsed\.cmd === "need_sync"[\s\S]{0,400}?continue;/.test(js));
check("connected 通知被跳过", /parsed\.msg === "connected"\)\s*continue/.test(js));

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
