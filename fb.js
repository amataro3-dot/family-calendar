/* Firebase のつなぎ(家族カレンダー専用のプロジェクト family-calendar-b69a0)
   - ログイン: Authentication の「メール / パスワード」。メールは画面に出さない「にせのメール」(名前 → メールは logins の表で引く)
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

/* ホストが家族のアカウントを作るとき用の、2つ目のつなぎ。これで作ると、ホストはログアウトしない */
let maker = null;
function makerAuth() {
  if (!maker) maker = getAuth(initializeApp(CONFIG, "maker"));
  return maker;
}

/* 名前 → 表の鍵(名前そのものは置かない。前後の空白・全角半角・大文字小文字はそろえる) */
export async function nameKey(name) {
  const s = String(name).normalize("NFKC").trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("muddys-family:" + s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
export const newMid = () => "m" + rand(8);
const newEmail = mid => `${mid}-${rand(6)}@family.muddys-games.com`;

const D = { family: () => doc(db, "config", "family"), user: uid => doc(db, "users", uid), login: key => doc(db, "logins", key) };

/* ---------- ログイン ---------- */
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export const logout = () => signOut(auth);

export async function login(name, pw) {
  const s = await getDoc(D.login(await nameKey(name)));
  if (!s.exists()) throw new Error("bad-login");
  await signInWithEmailAndPassword(auth, s.data().email, pw);
}

/* はじめての設定: ホストのアカウントと家族を作る。もう家族があれば、作ったアカウントを消して止める */
export async function setupFamily(name, pw, color) {
  const key = await nameKey(name);
  const mid = newMid(), email = newEmail(mid);
  const cred = await createUserWithEmailAndPassword(auth, email, pw);
  const uid = cred.user.uid;
  const b = writeBatch(db);
  b.set(D.family(), { hostUid: uid, members: { [mid]: { name: name.trim(), role: "host", color, uid } } });
  b.set(D.user(uid), { mid, role: "host" });
  b.set(D.login(key), { email });
  try { await b.commit(); }
  catch (e) {
    // 作ったアカウントは消す(消せなければログアウトだけ)。もう家族があるか、ルールが貼られていない
    try { await cred.user.delete(); } catch (x) { try { await signOut(auth); } catch (y) { } }
    const err = new Error("setup-failed"); err.code = "setup-failed:" + (e?.code || e?.message || ""); throw err;
  }
}

/* 自分(users/{uid})を読む。家族のメンバーでなければ null */
export async function loadMe(uid) {
  try { const s = await getDoc(D.user(uid)); return s.exists() ? s.data() : null; }
  catch (e) { return null; }
}

export function watchFamily(cb, err) { return onSnapshot(D.family(), s => cb(s.exists() ? s.data() : null), err); }

/* ---------- ホスト: 家族を足す・パスワードを作り直す・外す ---------- */
async function makeAccount(mid, pw) {
  const a = makerAuth(), email = newEmail(mid);
  const cred = await createUserWithEmailAndPassword(a, email, pw);
  const uid = cred.user.uid;
  await signOut(a);
  return { uid, email };
}

export async function addMember(name, role, color, pw) {
  const key = await nameKey(name);
  if ((await getDoc(D.login(key))).exists()) throw new Error("same-name");
  const mid = newMid();
  const { uid, email } = await makeAccount(mid, pw);
  const b = writeBatch(db);
  b.set(D.user(uid), { mid, role });
  b.update(D.family(), { ["members." + mid]: { name: name.trim(), role, color, uid } });
  b.set(D.login(key), { email });
  await b.commit();
}

export async function resetPassword(mid, m, pw) {
  const { uid, email } = await makeAccount(mid, pw);
  const b = writeBatch(db);
  b.set(D.user(uid), { mid, role: m.role });
  b.delete(D.user(m.uid));
  b.update(D.family(), { ["members." + mid + ".uid"]: uid });
  b.set(D.login(await nameKey(m.name)), { email });
  await b.commit();
}

export async function removeMember(mid, m) {
  const b = writeBatch(db);
  b.delete(D.user(m.uid));
  b.update(D.family(), { ["members." + mid]: deleteField() });
  b.delete(D.login(await nameKey(m.name)));
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
