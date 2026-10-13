# 指標と限界

| 指標                    | 定義                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GA4 PV                  | page_view数。本番の2hostnameを持つpage_locationだけ対象                                                             |
| 日次users               | user_pseudo_idのdaily DISTINCT。欠損IDは計上不可                                                                    |
| 日次activeUsers         | is_active_user=trueのdaily DISTINCT                                                                                 |
| 日次sessions            | 全イベントの(user_pseudo_id,ga_session_id)組DISTINCT。session_startの有無だけに依存しない                           |
| engagedSessions         | session_engaged=1を持つsession組DISTINCT                                                                            |
| engagementMs            | engagement_time_msec合計。UXの補助指標で、読了の推定ではない                                                        |
| 流入元                  | traffic_sourceの初回ユーザー獲得source/medium。セッション流入元とは別                                               |
| GSC全体click/impression | searchdata_site_impressionをproperty/dayでSUM                                                                       |
| GSCページ/query         | searchdata_url_impressionをpage/query/dayでSUM。全体に足さない                                                      |
| CTR                     | SUM(clicks)/SUM(impressions)。分母0はnull                                                                           |
| 平均順位                | site: SUM(sum_top_position)/SUM(impressions)+1、URL: SUM(sum_position)/SUM(impressions)+1。分母0/position欠損はnull |
| 前期間比較              | 同じ日数の直前期間。前値0/未取得は増減率null。coverageが違う場合は参考値                                            |
| AdSense                 | JPYの推定収益、広告表示、広告PV、広告クリック。確定支払ではない                                                     |
| AdSense RPM/CPC/CTR     | 収益/広告PV*1000、収益/広告click、広告click/広告impression。公式定義から未丸めの合計で計算                          |
| Affiliate               | providerが報告するpending/confirmed成果・報酬を分離。GA4クリックから成果を推測しない                                |

日次distinct users/sessionsは日をまたいで合計できない。概要の期間ユーザー/sessionは別のbounded queryで期間全体の組DISTINCTを計算し、analytics_period_countsへ数値だけ保存する。7/28/90日・月間・前期間・完了済み週/月を日次収集時に更新。任意93日以内は「期間人数を集計」で独立Actionsから取得できる。日次値の足し算や平均で期間uniqueを代用しない。期間cacheが日次集計より古い場合は—。export未取得日がある場合は取得済み日だけの値として人数カードに取得日数を明記する。生の識別子をD1へ持ち込まない。

期間queryは90日+前90日、任意93日+前93日のため最大186日に限定。日次queryは直近7日だけ。期間のdistinctは日次結果から正確に復元できないため、この追加読取が必要。UI/APIからBQへ直接queryしない。

GA4 UIはidentity、modeling、attributionなどの付加処理を行うのでBQ値と一致しない場合がある。匿名・consent・ID欠損、hostname不明イベントも差分要因。page_locationがないイベントは今回対象外。daily shardだけを読みintradayを排除する。GA4はproperty timezone、GSCはPacific日付、AdSenseはaccount timezone。表示日付をJSTへ勝手に付け替えない。取得時刻だけJST表示。

直近7日を再取得し、取得時点から4日以内は暫定と表示（以後も訂正がない保証ではない）。GSCの遅れとrare historical correctionsはExportLogを監視しbackfillする。匿名query（NULL/空文字/flag）は検索語行から除外し、全体/page合計には残す。数字の検索語を数値化しない。重複GSCキーは増分値としてSUMし、DISTINCTで削除しない。

AdSenseはDATEだけで先行実装。公式v2にPAGE_URL dimensionはあるが、accountで利用可能な組合せをまだ実認証で検証していないためページ収益は未取得表示。サイト収益をPV按分で捏造しない。リンククリック計測は既存UX/プライバシー方針を変えず、ASP adapterとGA4イベントの定義が決まるまで追加しない。

参照: [GA4 export schema](https://support.google.com/analytics/answer/7029846)、[GSC schema/ExportLog](https://support.google.com/webmasters/answer/12917991?hl=en)、[GA4 UIとの違い](https://support.google.com/analytics/answer/9358801)、[AdSense metrics](https://developers.google.com/adsense/management/reference/rest/v2/Metric)、[AdSense dimensions](https://developers.google.com/adsense/management/reference/rest/v2/Dimension)。

## 広告・読書体験の継続計測（reader-v1）

記事ページの本番apex/wwwだけで `diary_measurement` を送信する。配置版は `article-end-v1`。中盤35%・65%の本文座標が実際にビューポート内へ入ったときの候補到達を記録し、広告を追加しない。ページ内1回の本文25/50/75/90%・末尾到達、次記事リンク・共有・いいね操作を記録する。操作は成功や遷移完了を保証しない。本文末到達は読了の証明ではない。

可視ページ時間は表示中の差分だけをhidden/pagehide時に送信し、背景時間を除外する。1表示30分で打ち切る。注意や実際の読書時間とは異なる。広告はリクエスト、filled/unfilled、script error、filled枠が50%以上可視かつページ可視で連続1秒の視認目安を分ける。視認目安はAdSense公式Active Viewではない。広告クリック・iframe内部を観測しない。ブロックで欠けるイベントや同意・計測不能な訪問は含まれない。

LCP/INP/CLSは公式web-vitalsライブラリの数値だけを送信し、要素・URL・attribution・識別子は送らない。良好/要改善/不良のサンプル数を集計し、期間累積分布からp75の**区分**だけを求める。日次p75や割合は加算・平均しない。各50サンプル未満では区分を判定しない。INPは操作がないページでは報告されない。カウントはユーザー数ではない。

専用SQLは日次export31日以内、1GB課金上限、文字列と数値をallowlistで検証。GA4の既存日にexperience grainを追加し、本文URLのquery/fragmentを除去、routeで記事に対応づける。独自パラメータはBigQueryのevent_paramsで読むため、GA4カスタムディメンションの作成は不要。導入前に遡って復元できず、未取得期間は空欄とする。ページ別・端末別・配置版別に保持し、全体と記事フィルターの管理画面、週次・月次の私的レポートへ保存する。

配置検討は端末別200計測表示・14計測日を目安とし、週次で観察、月次/28日で再検討する。現在の広告機会・配信率・候補到達に加え、推定収益・本文末到達・回遊・速度・流入構成を併せて判断する。単純な前後差から因果効果を断定しない。本数・位置は自動変更しない。AdSense認証後はDiaryドメインで絞ったDATE×AD_UNIT_IDとAD_REQUESTSを収集し、サイト収益とユニット収益は別grainに保持して二重加算を避ける。
