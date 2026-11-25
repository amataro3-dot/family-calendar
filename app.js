/* カレンダー(家族用) 画面(v=2)
   - ログイン → 月のカレンダー。日を押すとその日の予定。＋で予定を書く
   - 見せる相手: 大人は「家族みんな / 大人だけ / 自分だけ / えらぶ」。子どもの予定はいつも家族みんな
   - 直す・消すは、書いた本人だけ。ホストは「家族の設定」で人を足す・パスワードを作り直す・外す */
import * as F from "./fb.js?v=2";

const COLORS = ["#e8664a", "#3b82c4", "#3a9d6a", "#d4a017", "#9b59b6", "#e05a9a", "#16a3a3", "#7a8a99"];
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const VIS = { all: "家族みんな", adults: "大人だけ", self: "自分だけ", pick: "えらぶ" };
const ROLE = { host: "ホスト", adult: "大人", child: "子ども" };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dayLabel = s => { const d = parse(s); return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; };

const S = {
  me: null,        // { uid, mid, role }
  fam: null,       // config/family
  events: [],
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  sel: ymd(new Date()),
  stop: [],        // 見張りを止める関数
};
const members = () => S.fam?.members || {};
const mem = mid => members()[mid];
const isAdult = role => role === "host" || role === "adult";
const isHost = () => S.me?.role === "host";

/* ---------- ちょっとした知らせ ---------- */
let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600);
}
function errMsg(e) {
  const c = e?.code || e?.message || "";
  if (/bad-login|invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "名前かパスワードがちがいます";
  if (/weak-password/.test(c)) return "パスワードは6文字以上にしてください";
  if (/too-many-requests/.test(c)) return "何回もまちがえたので、少し待ってからやり直してください";
  if (/network|unavailable/.test(c)) return "つながりません。電波のいい所でやり直してください";
  if (/already/.test(c)) return "もう家族の設定がされています。ホストに名前とパスワードを作ってもらってください";
  if (/same-name/.test(c)) return "同じ名前の人がもういます";
  if (/permission/.test(c)) return "この操作はできません";
  return "うまくいきませんでした(" + c + ")";
}

/* ---------- 下から出る画面(シート)。Android の戻るボタンで閉じる ---------- */
function openSheet(html, onReady) {
  const sh = $("sheet");
  sh.innerHTML = `<div class="sheet-in">${html}</div>`;
  sh.hidden = false;
  document.body.classList.add("noscroll");
  if (!history.state?.sheet) history.pushState({ sheet: 1 }, "");
  onReady && onReady(sh);
}
function closeSheet(fromPop) {
  const sh = $("sheet");
  if (sh.hidden) return;
  sh.hidden = true; sh.innerHTML = "";
  document.body.classList.remove("noscroll");
  if (!fromPop && history.state?.sheet) history.back();
}
addEventListener("popstate", () => closeSheet(true));

/* パスワードの欄と「見る」ボタン(押すと文字が見える・もう一度押すと隠す) */
function pwBox(id, ac) {
  return `<span class="pw"><input id="${id}" type="password" autocomplete="${ac}" minlength="${ac === "new-password" ? 6 : 1}" required><button type="button" class="eye" data-eye="${id}" aria-label="パスワードを見る">👁</button></span>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-eye]"); if (!b) return;
  const i = $(b.dataset.eye), show = i.type === "password";
  i.type = show ? "text" : "password";
  b.classList.toggle("on", show); b.setAttribute("aria-label", show ? "パスワードを隠す" : "パスワードを見る");
});

/* ---------- ログインの画面 ---------- */
function showLogin(msg) {
  stopWatch();
  $("app").innerHTML = `<div class="login">
<h1>📅 カレンダー</h1>
<form id="lf" class="card">
<label>名前<input id="ln" autocomplete="username" required></label>
<label>パスワード${pwBox("lp", "current-password")}</label>
<button class="main" id="lb">ログイン</button>
<p class="err" id="le">${esc(msg || "")}</p>
</form>
<p class="small"><a href="#" id="setup">はじめての設定(ホストになる)</a></p>
</div>`;
  $("lf").onsubmit = async e => {
    e.preventDefault();
    $("lb").disabled = true; $("le").textContent = "";
    try { await F.login($("ln").value, $("lp").value); }
    catch (x) { $("le").textContent = errMsg(x); $("lb").disabled = false; }
  };
  $("setup").onclick = e => { e.preventDefault(); showSetup(); };
}

function colorPick(name, sel) {
  return `<div class="colors">${COLORS.map(c => `<label><input type="radio" name="${name}" value="${c}" ${c === sel ? "checked" : ""}><span style="background:${c}"></span></label>`).join("")}</div>`;
}

function showSetup() {
  $("app").innerHTML = `<div class="login">
<h1>📅 はじめての設定</h1>
<form id="sf" class="card">
<p class="small">あなたがホストになります。ほかの家族の名前とパスワードは、このあと「家族の設定」で作ります。</p>
<label>あなたの名前<input id="sn" maxlength="12" required></label>
<label>パスワード(6文字以上)${pwBox("sp", "new-password")}</label>
<label>もう一度${pwBox("sp2", "new-password")}</label>
<div class="lbl">あなたの色</div>${colorPick("sc", COLORS[0])}
<button class="main" id="sb">作る</button>
<p class="err" id="se"></p>
</form>
<p class="small"><a href="#" id="back">← ログインにもどる</a></p>
</div>`;
  $("back").onclick = e => { e.preventDefault(); showLogin(); };
  $("sf").onsubmit = async e => {
    e.preventDefault();
    if ($("sp").value !== $("sp2").value) { $("se").textContent = "パスワードが同じではありません"; return; }
    $("sb").disabled = true; $("se").textContent = "";
    try { await F.setupFamily($("sn").value, $("sp").value, document.querySelector("input[name=sc]:checked").value); }
    catch (x) { $("se").textContent = errMsg(x); $("sb").disabled = false; }
  };
}

/* ---------- ログインしたあと ---------- */
function stopWatch() { S.stop.forEach(f => { try { f(); } catch (e) { } }); S.stop = []; }

async function start(user) {
  $("app").innerHTML = `<p class="loading">読みこみ中…</p>`;
  const me = await F.loadMe(user.uid);
  if (!me) { await F.logout(); showLogin("この家族のメンバーではありません。ホストに聞いてください"); return; }
  S.me = { uid: user.uid, ...me };
  S.fam = null; S.events = [];
  const onErr = e => { console.warn(e); toast(errMsg(e)); };
  S.stop.push(F.watchFamily(f => {
    S.fam = f;
    if (f && !f.members?.[S.me.mid]) { F.logout(); return; }   // 外された
    render();
  }, e => {
    // 外された・パスワードを作り直された(前のアカウント)ときは、読めなくなるのでログアウト
    if (/permission/.test(e?.code || "")) { F.logout().then(() => showLogin("ログインし直してください")); return; }
    onErr(e);
  }));
  S.stop.push(F.watchEvents(S.me.mid, list => { S.events = list; render(); }, onErr));
}

F.watchAuth(user => {
  closeSheet();
  if (user) start(user); else { S.me = null; showLogin(); }
});

/* ---------- カレンダー ---------- */
function eventsOn(day) {
  return S.events.filter(e => e.date === day).sort((a, b) =>
    (b.allDay - a.allDay) || (a.start || "").localeCompare(b.start || "") || (a.title || "").localeCompare(b.title || ""));
}
const colorOf = mid => mem(mid)?.color || "#aaa";
const nameOf = mid => mem(mid)?.name || "(いない人)";

function visLabel(e) {
  if (e.vis === "all") return "";
  if (e.vis === "adults") return "👪 大人だけ";
  if (e.vis === "self") return "🔒 自分だけ";
  const others = (e.viewers || []).filter(v => v !== e.author).map(nameOf);
  return "👀 " + [nameOf(e.author), ...others].join("・");
}
const timeLabel = e => e.allDay ? "終日" : (e.start || "") + (e.end ? "〜" + e.end : "");

function render() {
  if (!S.me || !S.fam) return;
  const m = S.month, y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1 - m.getDay());
  const today = ymd(new Date());
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    const k = ymd(d), evs = eventsOn(k);
    const cls = ["d", d.getMonth() !== mo && "out", k === today && "today", k === S.sel && "sel", d.getDay() === 0 && "sun", d.getDay() === 6 && "sat"].filter(Boolean).join(" ");
    const dots = evs.slice(0, 4).map(e => `<i style="background:${colorOf(e.author)}"></i>`).join("") + (evs.length > 4 ? `<b>+</b>` : "");
    cells += `<button class="${cls}" data-d="${k}"><span class="n">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
    if (i === 34 && new Date(y, mo, 1 - m.getDay() + 35).getMonth() !== mo) break;   // 5週で足りる月は5週
  }
  const meM = mem(S.me.mid) || {};
  const list = eventsOn(S.sel);
  $("app").innerHTML = `
<header class="top">
 <button class="nav" id="prev" aria-label="前の月">‹</button>
 <button class="ym" id="ym">${y}年${mo + 1}月</button>
 <button class="nav" id="next" aria-label="次の月">›</button>
 <button class="who" id="who"><i style="background:${meM.color || "#aaa"}"></i>${esc(meM.name || "")}</button>
</header>
<div class="week">${WD.map((w, i) => `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}</div>
<div class="grid" id="grid">${cells}</div>
<section class="day">
 <h2>${dayLabel(S.sel)}</h2>
 ${list.length ? `<ul class="evs">${list.map(e => `<li data-id="${e.id}" style="--c:${colorOf(e.author)}">
  <span class="t">${esc(timeLabel(e))}</span>
  <span class="ti">${esc(e.title)}</span>
  <span class="by">${esc(nameOf(e.author))}${visLabel(e) ? ` <em>${esc(visLabel(e))}</em>` : ""}</span>
 </li>`).join("")}</ul>` : `<p class="empty">予定はありません</p>`}
</section>
<button class="fab" id="add" aria-label="予定を書く">＋</button>`;
  $("prev").onclick = () => { S.month = new Date(y, mo - 1, 1); render(); };
  $("next").onclick = () => { S.month = new Date(y, mo + 1, 1); render(); };
  $("ym").onclick = () => { const t = new Date(); S.month = new Date(t.getFullYear(), t.getMonth(), 1); S.sel = ymd(t); render(); };
  $("grid").onclick = e => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    S.sel = b.dataset.d;
    const d = parse(S.sel); if (d.getMonth() !== mo) S.month = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
  };
  document.querySelectorAll(".evs li").forEach(li => li.onclick = () => {
    const ev = S.events.find(x => x.id === li.dataset.id); if (!ev) return;
    ev.author === S.me.mid ? editEvent(ev) : showEvent(ev);
  });
  $("add").onclick = () => editEvent(null);
  $("who").onclick = showMenu;
  swipe($("grid"));
}

/* 左右にスワイプで月をかえる */
function swipe(el) {
  let x0 = null, y0 = 0;
  el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) $(dx < 0 ? "next" : "prev").click();
  });
}

/* ---------- 予定を見る(ほかの人の予定) ---------- */
function showEvent(e) {
  openSheet(`<h3><i class="dot" style="background:${colorOf(e.author)}"></i>${esc(e.title)}</h3>
<p class="meta">${esc(dayLabel(e.date))} ${esc(timeLabel(e))}</p>
${e.memo ? `<p class="memo">${esc(e.memo)}</p>` : ""}
<p class="meta">書いた人: ${esc(nameOf(e.author))}<br>見える人: ${esc(e.vis === "all" ? "家族みんな" : e.vis === "adults" ? "大人だけ" : visLabel(e).replace(/^👀 /, ""))}</p>
<p class="small">予定を直せるのは、書いた人だけです。</p>
<div class="btns"><button class="sub" id="x">閉じる</button></div>`, () => { $("x").onclick = () => closeSheet(); });
}

/* ---------- 予定を書く・直す ---------- */
function editEvent(e) {
  const child = !isAdult(S.me.role);
  const v = e || { title: "", date: S.sel, allDay: false, start: "", end: "", memo: "", vis: "all", viewers: [] };
  const others = Object.entries(members()).filter(([id]) => id !== S.me.mid);
  openSheet(`<h3>${e ? "予定を直す" : "予定を書く"}</h3>
<form id="ef">
<label>タイトル<input id="et" maxlength="100" required value="${esc(v.title)}"></label>
<label>日にち<input id="ed" type="date" required value="${esc(v.date)}"></label>
<label class="chk"><input type="checkbox" id="ea" ${v.allDay ? "checked" : ""}> 終日</label>
<div class="row" id="etime"><label>はじまり<input id="es" type="time" step="300" value="${esc(v.start)}"></label><label>おわり<input id="ee" type="time" step="300" value="${esc(v.end)}"></label></div>
<label>メモ<textarea id="em" maxlength="1000" rows="3">${esc(v.memo)}</textarea></label>
<div class="lbl">見せる相手</div>
${child ? `<p class="small">子どもの予定は、家族みんなに見えます。</p>` : `
<div class="seg" id="ev">${Object.entries(VIS).map(([k, t]) => `<button type="button" data-v="${k}" class="${v.vis === k ? "on" : ""}">${t}</button>`).join("")}</div>
<div class="pick" id="ep" ${v.vis === "pick" ? "" : "hidden"}>${others.map(([id, m]) => `<label class="chk"><input type="checkbox" value="${id}" ${v.viewers.includes(id) ? "checked" : ""}><i class="dot" style="background:${m.color}"></i>${esc(m.name)}<small>${ROLE[m.role] || ""}</small></label>`).join("")}<p class="small">あなたにはいつも見えます。</p></div>
<p class="small" id="evh"></p>`}
<p class="err" id="ex"></p>
<div class="btns">${e ? `<button type="button" class="del" id="edel">消す</button>` : ""}<button type="button" class="sub" id="ec">やめる</button><button class="main" id="eok">保存</button></div>
</form>`, () => {
    let vis = child ? "all" : v.vis;
    const hint = () => { if ($("evh")) $("evh").textContent = { all: "家族みんなに見えます", adults: "大人だけに見えます(子どもには見えません)", self: "あなただけに見えます", pick: "チェックした人とあなたに見えます" }[vis]; };
    const timeOn = () => { $("etime").hidden = $("ea").checked; };
    $("ea").onchange = timeOn; timeOn(); hint();
    if (!child) $("ev").onclick = ev => {
      const b = ev.target.closest("[data-v]"); if (!b) return;
      vis = b.dataset.v;
      $("ev").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      $("ep").hidden = vis !== "pick"; hint();
    };
    $("ec").onclick = () => closeSheet();
    if (e) $("edel").onclick = async () => {
      if (!confirm("この予定を消しますか？")) return;
      try { await F.removeEvent(e.id); closeSheet(); toast("消しました"); } catch (x) { $("ex").textContent = errMsg(x); }
    };
    $("ef").onsubmit = async ev => {
      ev.preventDefault();
      const all = Object.keys(members());
      let viewers;
      if (vis === "all") viewers = all;
      else if (vis === "adults") viewers = all.filter(id => isAdult(mem(id).role));
      else if (vis === "self") viewers = [S.me.mid];
      else viewers = [S.me.mid, ...[...$("ep").querySelectorAll("input:checked")].map(x => x.value)];
      viewers = [...new Set([S.me.mid, ...viewers])];
      if (vis === "pick" && viewers.length === 1) { $("ex").textContent = "見せる人を1人以上えらんでください(自分だけなら「自分だけ」)"; return; }
      const allDay = $("ea").checked;
      const start = allDay ? "" : $("es").value, end = allDay ? "" : $("ee").value;
      if (!allDay && !start) { $("ex").textContent = "はじまりの時間を入れてください(時間がなければ「終日」)"; return; }
      if (end && start && end < start) { $("ex").textContent = "おわりの時間が、はじまりより前です"; return; }
      const data = { title: $("et").value.trim(), date: $("ed").value, allDay, start, end, memo: $("em").value.trim(), author: S.me.mid, vis, viewers };
      if (!data.title) { $("ex").textContent = "タイトルを入れてください"; return; }
      $("eok").disabled = true;
      try {
        if (e) await F.saveEvent(e.id, data); else await F.addEvent(data);
        S.sel = data.date; const d = parse(data.date); S.month = new Date(d.getFullYear(), d.getMonth(), 1);
        closeSheet(); render(); toast(e ? "直しました" : "書きました");
      } catch (x) { $("ex").textContent = errMsg(x); $("eok").disabled = false; }
    };
  });
}

/* ---------- メニュー(名前を押したとき) ---------- */
function showMenu() {
  const m = mem(S.me.mid) || {};
  openSheet(`<h3><i class="dot" style="background:${m.color}"></i>${esc(m.name)} <small>${ROLE[S.me.role] || ""}</small></h3>
<div class="menu">
${isHost() ? `<button class="sub" id="mf">👪 家族の設定</button>` : ""}
<button class="sub" id="mc">🎨 自分の色をかえる</button>
<button class="sub" id="mo">ログアウト</button>
<button class="sub" id="mx">閉じる</button>
</div>`, () => {
    if (isHost()) $("mf").onclick = showFamily;
    $("mc").onclick = () => openSheet(`<h3>自分の色</h3>${colorPick("mc2", m.color)}<p class="err" id="ce"></p><div class="btns"><button class="sub" id="cx">やめる</button><button class="main" id="cok">決める</button></div>`, () => {
      $("cx").onclick = () => closeSheet();
      $("cok").onclick = async () => {
        try { await F.setColor(S.me.mid, document.querySelector("input[name=mc2]:checked").value); closeSheet(); }
        catch (x) { $("ce").textContent = errMsg(x); }
      };
    });
    $("mo").onclick = async () => { if (confirm("ログアウトしますか？")) { closeSheet(); await F.logout(); } };
    $("mx").onclick = () => closeSheet();
  });
}

/* ---------- 家族の設定(ホストだけ) ---------- */
function showFamily() {
  const list = Object.entries(members()).sort((a, b) => ({ host: 0, adult: 1, child: 2 }[a[1].role] - { host: 0, adult: 1, child: 2 }[b[1].role]));
  const used = new Set(list.map(([, m]) => m.color));
  const free = COLORS.find(c => !used.has(c)) || COLORS[0];
  openSheet(`<h3>👪 家族の設定</h3>
<ul class="fam">${list.map(([id, m]) => `<li><i class="dot" style="background:${m.color}"></i><b>${esc(m.name)}</b><small>${ROLE[m.role]}</small>
${m.role === "host" ? "" : `<span class="fb"><button class="mini" data-r="${id}">パスワードを作り直す</button><button class="mini del" data-x="${id}">外す</button></span>`}</li>`).join("")}</ul>
<form id="af" class="card">
<div class="lbl">家族を足す</div>
<label>名前<input id="an" maxlength="12" required></label>
<div class="seg" id="ar"><button type="button" data-v="adult" class="on">大人</button><button type="button" data-v="child">子ども</button></div>
<label>最初のパスワード(6文字以上)<input id="ap" minlength="6" required autocomplete="off"></label>
<div class="lbl">色</div>${colorPick("ac", free)}
<button class="main" id="ab">足す</button>
<p class="small">名前とパスワードを、その人に伝えてください。</p>
</form>
<p class="err" id="fe"></p>
<div class="btns"><button class="sub" id="fx">閉じる</button></div>`, sh => {
    let role = "adult";
    $("ar").onclick = e => { const b = e.target.closest("[data-v]"); if (!b) return; role = b.dataset.v; $("ar").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); };
    $("fx").onclick = () => closeSheet();
    $("af").onsubmit = async e => {
      e.preventDefault(); $("ab").disabled = true; $("fe").textContent = "";
      try {
        const name = $("an").value.trim();
        await F.addMember(name, role, document.querySelector("input[name=ac]:checked").value, $("ap").value);
        toast(`${name}さんを足しました`); showFamily();
      } catch (x) { $("fe").textContent = errMsg(x); $("ab").disabled = false; }
    };
    sh.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
      const id = b.dataset.r, m = mem(id);
      openSheet(`<h3>${esc(m.name)}さんのパスワード</h3>
<form id="rf"><label>新しいパスワード(6文字以上)<input id="rp" minlength="6" required autocomplete="off"></label>
<p class="small">前のパスワードは使えなくなります。予定はそのまま残ります。</p>
<p class="err" id="re"></p>
<div class="btns"><button type="button" class="sub" id="rx">やめる</button><button class="main" id="rok">作り直す</button></div></form>`, () => {
        $("rx").onclick = showFamily;
        $("rf").onsubmit = async e => {
          e.preventDefault(); $("rok").disabled = true;
          try { await F.resetPassword(id, m, $("rp").value); toast("作り直しました"); showFamily(); }
          catch (x) { $("re").textContent = errMsg(x); $("rok").disabled = false; }
        };
      });
    });
    sh.querySelectorAll("[data-x]").forEach(b => b.onclick = async () => {
      const id = b.dataset.x, m = mem(id);
      if (!confirm(`${m.name}さんを家族から外しますか？\n(${m.name}さんはログインできなくなります。書いた予定は残ります)`)) return;
      try { await F.removeMember(id, m); toast("外しました"); showFamily(); } catch (x) { $("fe").textContent = errMsg(x); }
    });
  });
}
