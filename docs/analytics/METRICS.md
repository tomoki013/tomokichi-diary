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
