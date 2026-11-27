/* Firebase のつなぎ(家族カレンダー専用のプロジェクト family-calendar-b69a0)
   - ログイン: Authentication の「メール / パスワード」。メールは画面に出さない「にせのメール」
   - 登録(v=4〜): ホストが「名前・大人/子ども・色」だけを用意する(open/{mid} に名前が出る)。
     家族はログイン画面の「はじめて使う人」で自分の名前を押して、自分でパスワードを決める(claim)
   - データ: Firestore。ルールは muddys-notes の firebase/family-calendar_rules.txt(このリポジトリの firestore.rules と同じ)
   - ウェブ用の設定(apiKey など)は公開してよいもの */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, query, where, onSnapshot, writeBatch,
  addDoc, updateDoc, deleteDoc, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CONFIG = {
  apiKey: "AIzaSyBao-j-Mmh4rkPtTIOEPPLTJJHoVhkVgJ8",
  authDomain: "family-calendar-b69a0.firebaseapp.com",
  projectId: "family-calendar-b69a0",
  storageBucket: "family-calendar-b69a0.firebasestorage.app",
  messagingSenderId: "536314670650",
  appId: "1:536314670650:web:612378ccf8a65b94b6cf03"
};

const app = initializeApp(CONFIG);
export const auth = getAuth(app);   // ログインはスマホに覚えさせる(ログアウトを押すまで)
export const db = getFirestore(app);

/* 名前 → 表の鍵(名前そのものは置かない。前後の空白・全角半角・大文字小文字はそろえる) */
export async function nameKey(name) {
  const s = String(name).normalize("NFKC").trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("muddys-family:" + s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const newMid = () => "m" + rand(8);
const newEmail = mid => `${mid}-${rand(6)}@family.muddys-games.com`;

/* データの場所
   config/family  家族(hostUid・members.{mid} = {name, role, color})。メンバーだけ読める
   config/public  { ready: true }。家族がもうあるか(ログイン画面で「はじめての設定」を出すかどうか)。だれでも読める
   users/{uid}    { mid }。ログインした人 → 家族の番号。自分のだけ読める
   keys/{名前の鍵} { mid }。ログインのとき、名前 → 家族の番号
   logins/{mid}   { email }。家族の番号 → にせのメール
   links/{mid}    { uid }。家族の番号 → ログインのアカウント(ホストが外す・リセットするとき用)
   open/{mid}     { name }。まだ登録していない人。ログイン画面の「はじめて使う人」に出る */
const D = {
  family: () => doc(db, "config", "family"), pub: () => doc(db, "config", "public"),
  user: uid => doc(db, "users", uid), key: k => doc(db, "keys", k), login: mid => doc(db, "logins", mid),
  link: mid => doc(db, "links", mid), open: mid => doc(db, "open", mid),
  oldLogin: k => doc(db, "logins", k),   // v=3 までの形(logins/{名前の鍵} = {email})
};

/* ---------- ログイン ---------- */
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export const logout = () => signOut(auth);

export async function login(name, pw) {
  const k = await nameKey(name);
  let email = null;
  const ks = await getDoc(D.key(k));
  if (ks.exists()) { const ls = await getDoc(D.login(ks.data().mid)); if (ls.exists()) email = ls.data().email; }
  if (!email) { const old = await getDoc(D.oldLogin(k)); if (old.exists()) email = old.data().email; }   // v=3 までに作った人
  if (!email) throw new Error("bad-login");
  await signInWithEmailAndPassword(auth, email, pw);
}

/* 家族がもうあるか(だれでも読める) */
export async function isReady() {
  try { return (await getDoc(D.pub())).exists(); } catch (e) { return false; }
}

/* まだ登録していない人(ログイン画面の「はじめて使う人」) */
export function watchOpen(cb) {
  return onSnapshot(collection(db, "open"), s => cb(s.docs.map(d => ({ mid: d.id, name: d.data().name }))), () => cb([]));
}

/* 自分で登録する: アカウントを作って、用意された家族の番号につなぐ */
export async function claim(mid, pw) {
  const email = newEmail(mid);
  const cred = await createUserWithEmailAndPassword(auth, email, pw);
  const uid = cred.user.uid;
  const b = writeBatch(db);
  b.set(D.user(uid), { mid });
  b.set(D.link(mid), { uid });
  b.set(D.login(mid), { email });
  b.delete(D.open(mid));
  try { await b.commit(); }
  catch (e) {
    try { await cred.user.delete(); } catch (x) { try { await signOut(auth); } catch (y) { } }
    const err = new Error("claim-failed"); err.code = "claim-failed:" + (e?.code || e?.message || ""); throw err;
  }
}

/* はじめての設定: ホストのアカウントと家族を作る。もう家族があれば、作ったアカウントを消して止める */
export async function setupFamily(name, pw, color) {
  const k = await nameKey(name);
  const mid = newMid(), email = newEmail(mid);
  const cred = await createUserWithEmailAndPassword(auth, email, pw);
  const uid = cred.user.uid;
  const b = writeBatch(db);
  b.set(D.family(), { hostUid: uid, members: { [mid]: { name: name.trim(), role: "host", color } } });
  b.set(D.pub(), { ready: true });
  b.set(D.user(uid), { mid });
  b.set(D.key(k), { mid });
  b.set(D.login(mid), { email });
  b.set(D.link(mid), { uid });
  try { await b.commit(); }
  catch (e) {
    try { await cred.user.delete(); } catch (x) { try { await signOut(auth); } catch (y) { } }
    const err = new Error("setup-failed"); err.code = "setup-failed:" + (e?.code || e?.message || ""); throw err;
  }
}

/* v=3 までに作ったホストを、いまの形にそろえる(ホストがログインしたとき1回) */
export async function upgradeHost(mid, m) {
  if (await isReady()) return;
  const b = writeBatch(db);
  b.set(D.pub(), { ready: true });
  b.set(D.key(await nameKey(m.name)), { mid });
  b.set(D.login(mid), { email: auth.currentUser.email });
  b.set(D.link(mid), { uid: auth.currentUser.uid });
  await b.commit();
}

/* 自分(users/{uid})を読む。家族のメンバーでなければ null */
export async function loadMe(uid) {
  try { const s = await getDoc(D.user(uid)); return s.exists() ? s.data() : null; }
  catch (e) { return null; }
}

export function watchFamily(cb, err) { return onSnapshot(D.family(), s => cb(s.exists() ? s.data() : null), err); }

/* ---------- ホスト: 家族を用意する・パスワードをリセット・外す ---------- */
export async function addMember(name, role, color) {
  const k = await nameKey(name);
  if ((await getDoc(D.key(k))).exists() || (await getDoc(D.oldLogin(k))).exists()) throw new Error("same-name");
  const mid = newMid();
  const b = writeBatch(db);
  b.update(D.family(), { ["members." + mid]: { name: name.trim(), role, color } });
  b.set(D.key(k), { mid });
  b.set(D.open(mid), { name: name.trim() });
  await b.commit();
}

async function uidOf(mid, m) {
  try { const s = await getDoc(D.link(mid)); if (s.exists()) return s.data().uid; } catch (e) { }
  return m.uid || null;   // v=3 までは members に uid があった
}

/* パスワードをリセット: 前のアカウントを使えなくして、「はじめて使う人」にもう一度出す。予定はそのまま */
export async function resetMember(mid, m) {
  const uid = await uidOf(mid, m), k = await nameKey(m.name);
  const b = writeBatch(db);
  if (uid) b.delete(D.user(uid));
  b.delete(D.link(mid));
  b.delete(D.login(mid));
  b.delete(D.oldLogin(k));
  b.set(D.key(k), { mid });
  b.set(D.open(mid), { name: m.name });
  if (m.uid) b.update(D.family(), { ["members." + mid + ".uid"]: deleteField() });
  await b.commit();
}

export async function removeMember(mid, m) {
  const uid = await uidOf(mid, m), k = await nameKey(m.name);
  const b = writeBatch(db);
  if (uid) b.delete(D.user(uid));
  b.delete(D.link(mid));
  b.delete(D.login(mid));
  b.delete(D.oldLogin(k));
  b.delete(D.key(k));
  b.delete(D.open(mid));
  b.update(D.family(), { ["members." + mid]: deleteField() });
  await b.commit();
}

export async function setColor(mid, color) {
  await updateDoc(D.family(), { ["members." + mid + ".color"]: color });
}

/* ---------- 予定 ---------- */
/* 自分に見せてもらえる予定だけを取りに行く(ルールでも同じことを確かめる) */
export function watchEvents(mid, cb, err) {
  const q = query(collection(db, "events"), where("viewers", "array-contains", mid));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), err);
}
export const addEvent = ev => addDoc(collection(db, "events"), { ...ev, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
export const saveEvent = (id, ev) => updateDoc(doc(db, "events", id), { ...ev, updatedAt: serverTimestamp() });
export const removeEvent = id => deleteDoc(doc(db, "events", id));
