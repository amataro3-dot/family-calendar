# カレンダー(家族用)

家族4人で使う、予定を共有するカレンダー。予定ごとに見せる相手を決められる(子どもに見せない予定は、子どものスマホに届かない)。

- URL: https://calendar.muddys-games.com/ (2026-11-26〜。前の muddys-games.com/family-calendar/ からは GitHub が自動でうつす。サイトからはリンクしない・noindex)
- 仕様・引き継ぎ: `amataro3-dot/muddys-notes` の `family-calendar/`
- Firebase: 専用プロジェクト `family-calendar-b69a0`(Authentication のメール/パスワード + Firestore)
- ルール: `firestore.rules`(Firebase → Firestore Database → ルール に貼って公開)

| ファイル | 中身 |
| --- | --- |
| `index.html` | 読みこむだけ。`?v=番号` つき |
| `app.js` | 画面(ログイン・カレンダー・予定・家族の設定) |
| `fb.js` | Firebase のつなぎ(ログイン・家族・予定) |
| `style.css` | 見た目 |
| `manifest.webmanifest` `icons/` | ホーム画面に追加したとき(PWA)。場所はすべて相対 |
| `CNAME` | 独自ドメイン calendar.muddys-games.com(GitHub が作った。消さない) |
| `firestore.rules` | Firestore のルール |
| `tools/set-version.mjs` | キャッシュよけの番号をそろえる(`node tools/set-version.mjs 2`) |
