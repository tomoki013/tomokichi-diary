export type SemanticEvent =
  | {
      readonly name: "diary_measurement";
      readonly measurement_version: "reader-v1";
      readonly layout_version: "article-end-v1" | "article-placement-v2";
      readonly experiment_id?: string;
      readonly variant_id?: "A" | "B" | "none";
      readonly placement_key?: string;
      readonly measurement: string;
      readonly value: number;
      readonly placement: string;
      readonly vital: string;
      /** The article the event belongs to, when it is sent from the next page. */
      readonly page_location?: string;
    }
  | { readonly name: "article_published"; readonly articleId: string }
  | {
      readonly name: "internal_link_click";
      readonly source_slug: string;
      readonly destination_slug: string;
      readonly body_position: "intro" | "middle" | "end";
    }
  | {
      readonly name: "affiliate_click";
      readonly source_slug: string;
      readonly provider: string;
      readonly offer_id?: string;
      readonly placement_id: string;
    }
  | {
      readonly name: "ad_slot_rendered";
      readonly source_slug: string;
      readonly slot_type: "body_slot" | "article_end" | "anchor";
      readonly ad_status: "filled" | "unfilled" | "unfill-optimized" | "script_error";
    }
  | { readonly name: "knowledge_saved"; readonly articleId: string; readonly factCount: number }
  | {
      readonly name: "firsthand_fact_verified";
      readonly factId: string;
      readonly articleId: string;
    }
  | { readonly name: "travel_knowledge_viewed"; readonly articleId: string }
  | {
      readonly name: "travel_knowledge_searched";
      readonly query: string;
      readonly resultCount: number;
    }
  | {
      readonly name: "discovery_category_selected";
      readonly experience: string;
      readonly placement: "home";
    }
  | {
      readonly name: "discovery_article_clicked";
      readonly experience: string;
      readonly articleSlug: string;
      readonly placement: "home";
    }
  | {
      /** A reader opened a series' theme music player; not a play, which the frame hides. */
      readonly name: "series_music_open" | "series_music_external_open";
      readonly series_slug: string;
      readonly page_type: "article" | "collection";
      readonly provider: string;
    };

/** Vendor-neutral semantic events. Adapters may forward, log, or deliberately discard them. */
export interface AnalyticsPort {
  track(event: SemanticEvent): void | Promise<void>;
}

export const noOpAnalytics: AnalyticsPort = { track: () => {} };
