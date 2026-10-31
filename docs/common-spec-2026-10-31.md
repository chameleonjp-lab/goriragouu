# 共通仕様対応記録（2026-10-31）

## 対象・既存契約

ゴリラ豪雨は現行実験場DB `public.games` で `game_slug=goriragouu`、`is_active=true`。登録URL https://chameleonjp-lab.github.io/goriragouu/ のHTTP200と既存ゲームを確認した。詳細ランキングは https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=goriragouu 。このPRの変更はまだ公開していない。

基準コミット `0bf0a884e8f8970083e01afbb6cbab3c1179b7e8`、着手時の関連オープンPRなし。既存rules、README、公開設定、コード、テストを確認。Supabase `mlpnjgezrnhdxsxolyzj`、`submit_score`、`get_best_score_ranking`、game_slug・client_version、スコア式・丸め・60秒/10本ごとの+5秒・バナナ100点・難易度を変更しない。名前キー `chameleonjp_goriragouu_player_name`、自己ベスト `goriragouu-best-score`、音 `goriragouu-sound`、揺れ `goriragouu-motion` を維持する。

新設の設定は `goriragouu-volume` と `goriragouu-language` のみ。サーバーのスコア・参加者・実験場登録情報を削除/更新していない。別originの旧CodebergページのlocalStorageを自動移行する実装ではない。旧データは残し、名前・設定の手動再入力と旧ページの自己ベスト閲覧が可能。

## 対応表

| 項目 | 状態 | 内容・残件 |
|---|---|---|
| 1 対象 | 既存で対応済み | 現在のDB登録と公開URLを照合 |
| 2 記録・ルール | 既存維持 | 既存保存先/識別値/採点/プレイ条件は維持 |
| 3 正式URL | 既存で対応済み | GitHub公開URLはすでに実際の登録先。新たな切替不要 |
| 4 多言語 | 今回実装／一部未確認 | 本文・説明・状態・結果・設定・エラー・共有を15言語化。選択保存、ブラウザ言語、未対応/取得失敗はEnglish。自然さの母語確認は未実施 |
| 5 名前・登録 | 今回実装／一部未完了 | ホーム任意/空白除外、開始時名固定、名なし公開登録なし。サーバー名キーの移行、永続再送/再読込結果復元は未完了 |
| 6 ランキング | 今回実装／一部未完了 | 両画面詳細URL、既存集計RPC上位30、読込/空/失敗/読取再試行、古い応答排除。同名を本人と推定する表示を除去。参加者識別契約は残件 |
| 7 X共有 | 今回実装 | 黒白「Xでシェア」、各言語の紹介/今回結果と正式URL。投稿確定は本人、ポップアップ不可ならコピー/prompt代替 |
| 8 効果音 | 既存＋今回実装 | 既存生成SEの雰囲気維持。24声上限/ended切断、遅延音の停止と非表示抑制 |
| 9 音設定 | 今回実装 | 初回ON/既存ゲイン、保存OFF/0保持、ホーム音量、開始はunlock成功を待たない |
| 10 文言・画面 | 今回実装／一部未確認 | 公開範囲説明、短いルール/操作説明、長い翻訳折返し、IME誤開始抑制。実機未確認 |
| 11 自動公開 | 今回実装／設定が必要 | 既存PR CIを継続。mainの検証成功後、runtime allowlistを公開。現行Pages source legacyのためActionsへ変更が必要（下記） |
| 12 検証 | 実施／一部未確認 | 単体/静的46件成功。Chromiumの15言語/縦横/匿名/0保持/読取競合をモック確認（browser-check-2026-10-31.json）。iPhone実機、音の聴取、母語評価、本番配備は未確認 |
| 13 PRと記録 | 今回実装 | 本書・PRで依存/受入/戻し方/残件を明記 |

参照したサイノメ main `79b1e5733e725cd1148b10fa5699ba846e2bf57d` の15言語：ja/en/es/pt-BR/zh-Hans/fr/de/ko/ru/it/zh-Hant/id/tr/vi/th。表示の変更は進行中のrun ID・時間・バナナ数・得点・結果の送信状態を変更しない。日本語固有の問題を出すゲームではないため問題置換は対象外。

## 登録とランキングの限界

名なしで遊んだ結果は登録しない。入力した名は開始時に固定し、結果画面/再試行で編集値を読まない。既存の送信フラグで同一runの再送を防ぎ、ランキング再試行は読取のみ。通信待ち中も結果・ホーム/詳細/共有を操作できる。今回の結果と端末自己ベスト・サーバー自己ベストは区別する。

既存DBは表示名を参加者キーに使う。名前だけで別人を統合しない共通契約はサーバー移行が必要。表示名一致を「あなた」と断定する表示は削除した。冪等キーのないsubmit_scoreの失敗時に安全な再送を行う仕組み、再読込後の未送信結果復元は未完了。これらを対象外とはしない。

## SE一覧

全てブラウザ生成、課金/外部音源なし。既存音色/イベントを保持。

| イベント | 役割・発音条件 | 重複・停止 | 実装 |
|---|---|---|---|
| 3秒カウント/開始 | 開始タイミング | 既存カウント変化時のみ | AudioController.countdown |
| バナナ取得 | 取得の確認 | 24声上限・ended切断 | banana |
| 10本節目 | 時間延長の確認 | OFF中は予約しない。3音の遅延タイマー管理、非表示/OFF/0で破棄 | bonus |
| 豪雨/ゴリラ | 出現の補助 | 24声上限、buffer/filter/gainを切断 | storm/gorilla |
| 接触で終了 | 失敗の確認 | 確定状態で1回、既存音を停止して優先 | gameOver |
| 生還 | クリアの確認 | 確定状態で1回、既存音を停止して優先 | clear |

ホームOFF操作は設定を反映してからunlockを判断。音量0・非表示は新しい音を作らず、復帰時に遅延音をまとめて鳴らさない。音の聴取評価は未実施。

## 公開設定・適用順・戻し方

1. GitHub Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。APIでは `PUT /repos/chameleonjp-lab/goriragouu/pages` に `{ "build_type": "workflow" }`。読み戻しはGETで `build_type=workflow`、正式html_urlを確認する。既存のbranch保護/承認は解除しない。
2. ユーザーがPRをmainへマージ。既存CI/Pages testが通過後、index.html/styles.css/srcのみをsiteへ集め公開。開発ファイル/秘密情報は公開しない。current main SHAに一致しない古い再実行は配備前に停止する。
3. ActionsとPages deploymentのSHA、正式URLで15言語/任意名/音量/上位30 UIを確認。このPRの本番配備確認はマージ前には未実施。
4. 本番テストスコアを送らず、RPCモックで匿名/空白/名前変更/消去、失敗、読み直し、重複数を確認。iPhone Safariでは縦横/キーボード/画面端、日本語変換Enter、OFF/0→再読込、Xから復帰を確認する。
5. 問題時はrevert PRをmainへマージし同じActions経路で戻す。Pages source自体を戻す場合は元のlegacy/main/`/` を復元するが、workflow配備との二重実行を避ける。利用者データ/DBの削除は不要。

2026-10-31、PR作成後に公開ジョブが走っていないことを確認し、Pagesのbuild_type=workflow変更を試行したが、GitHub APIが403 `Resource not accessible by integration` を返した。読み戻しもlegacy/main/`/` のまま。自動承認レビューの拒否ではなくGitHubトークンの権限不足であり、管理者による上記Source設定が必要。公開・マージは行っていない。
