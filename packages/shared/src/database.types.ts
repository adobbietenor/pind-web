export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          adaptive: boolean
          adjust_min_gatherings: number
          adjust_min_lead_days: number
          adjust_window_days: number
          centre_lat: number | null
          centre_lng: number | null
          community_slots_weekly: number
          community_weeks: number
          core_radius_km: number | null
          distance_penalty_max: number | null
          distance_penalty_per_km: number | null
          grow_median_pins: number
          grow_reach: number
          import_weeks: number | null
          max_category_share: number
          max_per_venue_per_week: number
          min_capacity: number
          min_per_category: number
          name: string
          publish_lead_days_max: number
          publish_lead_days_min: number
          publish_max: number
          publish_min: number
          publish_target_weekly: number
          score_floor: number
          search_radius_km: number | null
          shrink_reach: number
          slug: string
          step_down: number
          step_up: number
          timezone: string
        }
        Insert: {
          adaptive?: boolean
          adjust_min_gatherings?: number
          adjust_min_lead_days?: number
          adjust_window_days?: number
          centre_lat?: number | null
          centre_lng?: number | null
          community_slots_weekly?: number
          community_weeks?: number
          core_radius_km?: number | null
          distance_penalty_max?: number | null
          distance_penalty_per_km?: number | null
          grow_median_pins?: number
          grow_reach?: number
          import_weeks?: number | null
          max_category_share?: number
          max_per_venue_per_week?: number
          min_capacity?: number
          min_per_category?: number
          name: string
          publish_lead_days_max?: number
          publish_lead_days_min?: number
          publish_max?: number
          publish_min?: number
          publish_target_weekly?: number
          score_floor?: number
          search_radius_km?: number | null
          shrink_reach?: number
          slug: string
          step_down?: number
          step_up?: number
          timezone: string
        }
        Update: {
          adaptive?: boolean
          adjust_min_gatherings?: number
          adjust_min_lead_days?: number
          adjust_window_days?: number
          centre_lat?: number | null
          centre_lng?: number | null
          community_slots_weekly?: number
          community_weeks?: number
          core_radius_km?: number | null
          distance_penalty_max?: number | null
          distance_penalty_per_km?: number | null
          grow_median_pins?: number
          grow_reach?: number
          import_weeks?: number | null
          max_category_share?: number
          max_per_venue_per_week?: number
          min_capacity?: number
          min_per_category?: number
          name?: string
          publish_lead_days_max?: number
          publish_lead_days_min?: number
          publish_max?: number
          publish_min?: number
          publish_target_weekly?: number
          score_floor?: number
          search_radius_km?: number | null
          shrink_reach?: number
          slug?: string
          step_down?: number
          step_up?: number
          timezone?: string
        }
        Relationships: []
      }
      community_check_runs: {
        Row: {
          actor: string
          ai_cost_usd: number
          city: string
          counts: Json
          error: string | null
          finished_at: string | null
          id: number
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          actor: string
          ai_cost_usd?: number
          city: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: never
          started_at?: string
          status?: string
          trigger: string
        }
        Update: {
          actor?: string
          ai_cost_usd?: number
          city?: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: never
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_check_runs_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["slug"]
          },
        ]
      }
      community_series: {
        Row: {
          cadence_seen: string | null
          confirmed_through: string | null
          created_at: string
          id: string
          label: string
          last_checked_at: string | null
          last_confirmed_at: string | null
          last_note: string | null
          last_status: string | null
          settled_at: string | null
          settled_by: string | null
          settled_note: string | null
          strikes: number
          unreadable_strikes: number
          url: string
        }
        Insert: {
          cadence_seen?: string | null
          confirmed_through?: string | null
          created_at?: string
          id?: string
          label: string
          last_checked_at?: string | null
          last_confirmed_at?: string | null
          last_note?: string | null
          last_status?: string | null
          settled_at?: string | null
          settled_by?: string | null
          settled_note?: string | null
          strikes?: number
          unreadable_strikes?: number
          url: string
        }
        Update: {
          cadence_seen?: string | null
          confirmed_through?: string | null
          created_at?: string
          id?: string
          label?: string
          last_checked_at?: string | null
          last_confirmed_at?: string | null
          last_note?: string | null
          last_status?: string | null
          settled_at?: string | null
          settled_by?: string | null
          settled_note?: string | null
          strikes?: number
          unreadable_strikes?: number
          url?: string
        }
        Relationships: []
      }
      confirmations: {
        Row: {
          created_at: string
          crew_id: string
          from_person: string
          kind: Database["public"]["Enums"]["confirmation_kind"]
          to_person: string
        }
        Insert: {
          created_at?: string
          crew_id: string
          from_person: string
          kind: Database["public"]["Enums"]["confirmation_kind"]
          to_person: string
        }
        Update: {
          created_at?: string
          crew_id?: string
          from_person?: string
          kind?: Database["public"]["Enums"]["confirmation_kind"]
          to_person?: string
        }
        Relationships: [
          {
            foreignKeyName: "confirmations_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmations_from_person_fkey"
            columns: ["from_person"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmations_to_person_fkey"
            columns: ["to_person"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          created_at: string
          id: string
          person_a: string
          person_b: string
          source_crew_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          person_a: string
          person_b: string
          source_crew_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          person_a?: string
          person_b?: string
          source_crew_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connections_person_a_fkey"
            columns: ["person_a"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_person_b_fkey"
            columns: ["person_b"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_source_crew_id_fkey"
            columns: ["source_crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_points: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["contact_kind"]
          opted_out_at: string | null
          person_id: string | null
          pin_friend_id: string | null
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["contact_kind"]
          opted_out_at?: string | null
          person_id?: string | null
          pin_friend_id?: string | null
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["contact_kind"]
          opted_out_at?: string | null
          person_id?: string | null
          pin_friend_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_points_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_points_pin_friend_id_fkey"
            columns: ["pin_friend_id"]
            isOneToOne: false
            referencedRelation: "pin_friends"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_join_requests: {
        Row: {
          created_at: string
          crew_id: string
          decided_at: string | null
          decided_by: string | null
          id: string
          person_id: string
          seats: number
          status: Database["public"]["Enums"]["join_request_status"]
        }
        Insert: {
          created_at?: string
          crew_id: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          person_id: string
          seats?: number
          status?: Database["public"]["Enums"]["join_request_status"]
        }
        Update: {
          created_at?: string
          crew_id?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          person_id?: string
          seats?: number
          status?: Database["public"]["Enums"]["join_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "crew_join_requests_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_join_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_join_requests_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          arrival_note: string | null
          arrived_at: string | null
          crew_id: string
          gathering_id: string
          id: string
          joined_at: string
          left_at: string | null
          person_id: string
          seats: number
        }
        Insert: {
          arrival_note?: string | null
          arrived_at?: string | null
          crew_id: string
          gathering_id: string
          id?: string
          joined_at?: string
          left_at?: string | null
          person_id: string
          seats?: number
        }
        Update: {
          arrival_note?: string | null
          arrived_at?: string | null
          crew_id?: string
          gathering_id?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          person_id?: string
          seats?: number
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_crew_id_gathering_id_fkey"
            columns: ["crew_id", "gathering_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id", "gathering_id"]
          },
          {
            foreignKeyName: "crew_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          crew_id: string
          hidden_at: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          crew_id: string
          hidden_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["message_kind"]
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          crew_id?: string
          hidden_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "crew_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_messages_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_proposal_votes: {
        Row: {
          created_at: string
          person_id: string
          proposal_id: string
        }
        Insert: {
          created_at?: string
          person_id: string
          proposal_id: string
        }
        Update: {
          created_at?: string
          person_id?: string
          proposal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_proposal_votes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_proposal_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "crew_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_proposals: {
        Row: {
          created_at: string
          crew_id: string
          id: string
          meet_at: string
          proposed_by: string | null
          spot_id: string
        }
        Insert: {
          created_at?: string
          crew_id: string
          id?: string
          meet_at: string
          proposed_by?: string | null
          spot_id: string
        }
        Update: {
          created_at?: string
          crew_id?: string
          id?: string
          meet_at?: string
          proposed_by?: string | null
          spot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_proposals_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_proposals_spot_id_fkey"
            columns: ["spot_id"]
            isOneToOne: false
            referencedRelation: "meeting_spots"
            referencedColumns: ["id"]
          },
        ]
      }
      crews: {
        Row: {
          created_at: string
          dissolved_at: string | null
          gathering_id: string
          hidden_at: string | null
          id: string
          meet_at: string | null
          sibling_of: string | null
          spot_id: string | null
          state: Database["public"]["Enums"]["crew_state"]
          updated_at: string
          women_only: boolean
        }
        Insert: {
          created_at?: string
          dissolved_at?: string | null
          gathering_id: string
          hidden_at?: string | null
          id?: string
          meet_at?: string | null
          sibling_of?: string | null
          spot_id?: string | null
          state?: Database["public"]["Enums"]["crew_state"]
          updated_at?: string
          women_only?: boolean
        }
        Update: {
          created_at?: string
          dissolved_at?: string | null
          gathering_id?: string
          hidden_at?: string | null
          id?: string
          meet_at?: string | null
          sibling_of?: string | null
          spot_id?: string | null
          state?: Database["public"]["Enums"]["crew_state"]
          updated_at?: string
          women_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crews_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crews_sibling_of_fkey"
            columns: ["sibling_of"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crews_spot_id_fkey"
            columns: ["spot_id"]
            isOneToOne: false
            referencedRelation: "meeting_spots"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_flags: {
        Row: {
          created_at: string
          gathering_id: string
          id: string
          kind: Database["public"]["Enums"]["gathering_flag_kind"]
          new_starts_at: string | null
          old_starts_at: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: Database["public"]["Enums"]["gathering_source"]
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          gathering_id: string
          id?: string
          kind: Database["public"]["Enums"]["gathering_flag_kind"]
          new_starts_at?: string | null
          old_starts_at?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source: Database["public"]["Enums"]["gathering_source"]
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          gathering_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["gathering_flag_kind"]
          new_starts_at?: string | null
          old_starts_at?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: Database["public"]["Enums"]["gathering_source"]
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_flags_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_group_links: {
        Row: {
          created_at: string
          gathering_id: string
          kind: Database["public"]["Enums"]["group_link_kind"]
          url: string
        }
        Insert: {
          created_at?: string
          gathering_id: string
          kind: Database["public"]["Enums"]["group_link_kind"]
          url: string
        }
        Update: {
          created_at?: string
          gathering_id?: string
          kind?: Database["public"]["Enums"]["group_link_kind"]
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_group_links_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_promotions: {
        Row: {
          channel: string
          gathering_id: string
          id: string
          note: string | null
          promoted_at: string
          promoted_by: string
        }
        Insert: {
          channel: string
          gathering_id: string
          id?: string
          note?: string | null
          promoted_at?: string
          promoted_by: string
        }
        Update: {
          channel?: string
          gathering_id?: string
          id?: string
          note?: string | null
          promoted_at?: string
          promoted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_promotions_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_slug_history: {
        Row: {
          gathering_id: string
          retired_at: string
          slug: string
        }
        Insert: {
          gathering_id: string
          retired_at?: string
          slug: string
        }
        Update: {
          gathering_id?: string
          retired_at?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_slug_history_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_sources: {
        Row: {
          external_id: string | null
          first_seen_at: string
          gathering_id: string
          id: string
          last_seen_at: string
          missing_since: string | null
          snapshot: Json | null
          source: Database["public"]["Enums"]["gathering_source"]
          urls: string[]
        }
        Insert: {
          external_id?: string | null
          first_seen_at?: string
          gathering_id: string
          id?: string
          last_seen_at?: string
          missing_since?: string | null
          snapshot?: Json | null
          source: Database["public"]["Enums"]["gathering_source"]
          urls?: string[]
        }
        Update: {
          external_id?: string | null
          first_seen_at?: string
          gathering_id?: string
          id?: string
          last_seen_at?: string
          missing_since?: string | null
          snapshot?: Json | null
          source?: Database["public"]["Enums"]["gathering_source"]
          urls?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "gathering_sources_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_spots: {
        Row: {
          gathering_id: string
          id: string
          meet_at: string
          spot_id: string
        }
        Insert: {
          gathering_id: string
          id?: string
          meet_at: string
          spot_id: string
        }
        Update: {
          gathering_id?: string
          id?: string
          meet_at?: string
          spot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_spots_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gathering_spots_spot_id_fkey"
            columns: ["spot_id"]
            isOneToOne: false
            referencedRelation: "meeting_spots"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_triage: {
        Row: {
          gathering_id: string
          model: string | null
          reason: string | null
          score: number | null
          scored_at: string
        }
        Insert: {
          gathering_id: string
          model?: string | null
          reason?: string | null
          score?: number | null
          scored_at?: string
        }
        Update: {
          gathering_id?: string
          model?: string | null
          reason?: string | null
          score?: number | null
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_triage_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: true
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_withdrawals: {
        Row: {
          gathering_id: string
          note: string | null
          reason: Database["public"]["Enums"]["withdraw_reason"]
          withdrawn_at: string
          withdrawn_by: string
        }
        Insert: {
          gathering_id: string
          note?: string | null
          reason: Database["public"]["Enums"]["withdraw_reason"]
          withdrawn_at?: string
          withdrawn_by: string
        }
        Update: {
          gathering_id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["withdraw_reason"]
          withdrawn_at?: string
          withdrawn_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_withdrawals_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: true
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gatherings: {
        Row: {
          blurb: string | null
          blurb_at: string | null
          blurb_source: string | null
          blurb_why: string | null
          capacity: number | null
          category: Database["public"]["Enums"]["gathering_category"] | null
          created_at: string
          dismissed_at: string | null
          door_price_cents: number | null
          ends_at: string | null
          entry: Database["public"]["Enums"]["entry_kind"]
          entry_note: string | null
          event_url: string | null
          featured: boolean
          id: string
          is_seed: boolean
          merged_into_id: string | null
          name: string
          publish_mark: Database["public"]["Enums"]["publish_mark"] | null
          published_at: string | null
          series_id: string | null
          signup_required: boolean
          signup_url: string | null
          slug: string | null
          source: Database["public"]["Enums"]["gathering_source"]
          starts_at: string
          status: string | null
          threshold_notified_at: string | null
          venue_id: string | null
          venue_name_raw: string | null
          withdrawn_at: string | null
        }
        Insert: {
          blurb?: string | null
          blurb_at?: string | null
          blurb_source?: string | null
          blurb_why?: string | null
          capacity?: number | null
          category?: Database["public"]["Enums"]["gathering_category"] | null
          created_at?: string
          dismissed_at?: string | null
          door_price_cents?: number | null
          ends_at?: string | null
          entry?: Database["public"]["Enums"]["entry_kind"]
          entry_note?: string | null
          event_url?: string | null
          featured?: boolean
          id?: string
          is_seed?: boolean
          merged_into_id?: string | null
          name: string
          publish_mark?: Database["public"]["Enums"]["publish_mark"] | null
          published_at?: string | null
          series_id?: string | null
          signup_required?: boolean
          signup_url?: string | null
          slug?: string | null
          source?: Database["public"]["Enums"]["gathering_source"]
          starts_at: string
          status?: string | null
          threshold_notified_at?: string | null
          venue_id?: string | null
          venue_name_raw?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          blurb?: string | null
          blurb_at?: string | null
          blurb_source?: string | null
          blurb_why?: string | null
          capacity?: number | null
          category?: Database["public"]["Enums"]["gathering_category"] | null
          created_at?: string
          dismissed_at?: string | null
          door_price_cents?: number | null
          ends_at?: string | null
          entry?: Database["public"]["Enums"]["entry_kind"]
          entry_note?: string | null
          event_url?: string | null
          featured?: boolean
          id?: string
          is_seed?: boolean
          merged_into_id?: string | null
          name?: string
          publish_mark?: Database["public"]["Enums"]["publish_mark"] | null
          published_at?: string | null
          series_id?: string | null
          signup_required?: boolean
          signup_url?: string | null
          slug?: string | null
          source?: Database["public"]["Enums"]["gathering_source"]
          starts_at?: string
          status?: string | null
          threshold_notified_at?: string | null
          venue_id?: string | null
          venue_name_raw?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gatherings_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gatherings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "community_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gatherings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          actor: string
          ai_cost_usd: number
          city: string
          counts: Json
          error: string | null
          finished_at: string | null
          id: number
          source: Database["public"]["Enums"]["gathering_source"]
          started_at: string
          status: string
          tm_calls: number
          trigger: string
        }
        Insert: {
          actor: string
          ai_cost_usd?: number
          city: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: never
          source: Database["public"]["Enums"]["gathering_source"]
          started_at?: string
          status?: string
          tm_calls?: number
          trigger: string
        }
        Update: {
          actor?: string
          ai_cost_usd?: number
          city?: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: never
          source?: Database["public"]["Enums"]["gathering_source"]
          started_at?: string
          status?: string
          tm_calls?: number
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["slug"]
          },
        ]
      }
      magic_links: {
        Row: {
          created_at: string
          expires_at: string
          gathering_id: string | null
          id: string
          person_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          gathering_id?: string | null
          id?: string
          person_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          gathering_id?: string | null
          id?: string
          person_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "magic_links_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "magic_links_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_spots: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          sort_order: number
          venue_id: string
          walk_minutes: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          sort_order?: number
          venue_id: string
          walk_minutes?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          sort_order?: number
          venue_id?: string
          walk_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_spots_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_log: {
        Row: {
          action: string
          actor: string
          at: string
          gathering_id: string | null
          id: number
          note: string | null
          person_id: string | null
          pin_id: string | null
          venue_id: string | null
        }
        Insert: {
          action: string
          actor: string
          at?: string
          gathering_id?: string | null
          id?: never
          note?: string | null
          person_id?: string | null
          pin_id?: string | null
          venue_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          at?: string
          gathering_id?: string | null
          id?: never
          note?: string | null
          person_id?: string | null
          pin_id?: string | null
          venue_id?: string | null
        }
        Relationships: []
      }
      neighbourhoods: {
        Row: {
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          name: string
          slug: string
          sort_order: number
        }
        Update: {
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      ops_alerts: {
        Row: {
          at: string
          error: string | null
          id: number
          kind: string
          local_day: string
          sent: boolean
          subject: string
        }
        Insert: {
          at?: string
          error?: string | null
          id?: never
          kind: string
          local_day?: string
          sent: boolean
          subject: string
        }
        Update: {
          at?: string
          error?: string | null
          id?: never
          kind?: string
          local_day?: string
          sent?: boolean
          subject?: string
        }
        Relationships: []
      }
      ops_import_schedule: {
        Row: {
          cron: string
          grace_minutes: number
          id: boolean
          reported_at: string | null
          reported_cron: string | null
          reported_scheduled_time: string | null
          utc_hour: number
          utc_minute: number
        }
        Insert: {
          cron?: string
          grace_minutes?: number
          id?: boolean
          reported_at?: string | null
          reported_cron?: string | null
          reported_scheduled_time?: string | null
          utc_hour?: number
          utc_minute?: number
        }
        Update: {
          cron?: string
          grace_minutes?: number
          id?: boolean
          reported_at?: string | null
          reported_cron?: string | null
          reported_scheduled_time?: string | null
          utc_hour?: number
          utc_minute?: number
        }
        Relationships: []
      }
      outbound_messages: {
        Row: {
          channel: Database["public"]["Enums"]["contact_kind"]
          gathering_id: string
          id: string
          kind: Database["public"]["Enums"]["outbound_kind"]
          person_id: string | null
          pin_friend_id: string | null
          provider_id: string | null
          sent_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["contact_kind"]
          gathering_id: string
          id?: string
          kind: Database["public"]["Enums"]["outbound_kind"]
          person_id?: string | null
          pin_friend_id?: string | null
          provider_id?: string | null
          sent_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["contact_kind"]
          gathering_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["outbound_kind"]
          person_id?: string | null
          pin_friend_id?: string | null
          provider_id?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_pin_friend_id_fkey"
            columns: ["pin_friend_id"]
            isOneToOne: false
            referencedRelation: "pin_friends"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          auth_user_id: string | null
          created_at: string
          first_name: string
          hidden_at: string | null
          id: string
          is_seed: boolean
          last_initial: string | null
          neighbourhood: string | null
          photo_path: string | null
          photo_status: Database["public"]["Enums"]["photo_status"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          first_name: string
          hidden_at?: string | null
          id?: string
          is_seed?: boolean
          last_initial?: string | null
          neighbourhood?: string | null
          photo_path?: string | null
          photo_status?: Database["public"]["Enums"]["photo_status"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          first_name?: string
          hidden_at?: string | null
          id?: string
          is_seed?: boolean
          last_initial?: string | null
          neighbourhood?: string | null
          photo_path?: string | null
          photo_status?: Database["public"]["Enums"]["photo_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_neighbourhood_fkey"
            columns: ["neighbourhood"]
            isOneToOne: false
            referencedRelation: "neighbourhoods"
            referencedColumns: ["slug"]
          },
        ]
      }
      people_private: {
        Row: {
          age_attested_at: string
          birth_year: number | null
          created_at: string
          gender: Database["public"]["Enums"]["gender"]
          include_in_women_only: boolean
          person_id: string
          updated_at: string
        }
        Insert: {
          age_attested_at?: string
          birth_year?: number | null
          created_at?: string
          gender: Database["public"]["Enums"]["gender"]
          include_in_women_only?: boolean
          person_id: string
          updated_at?: string
        }
        Update: {
          age_attested_at?: string
          birth_year?: number | null
          created_at?: string
          gender?: Database["public"]["Enums"]["gender"]
          include_in_women_only?: boolean
          person_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_private_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_handles: {
        Row: {
          created_at: string
          instagram: string
          person_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          instagram: string
          person_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          instagram?: string
          person_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_handles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_tags: {
        Row: {
          person_id: string
          tag: string
        }
        Insert: {
          person_id: string
          tag: string
        }
        Update: {
          person_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_tags_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_tags_tag_fkey"
            columns: ["tag"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["slug"]
          },
        ]
      }
      photo_checks: {
        Row: {
          ai_cost_usd: number
          at: string
          duration_ms: number | null
          error: string | null
          id: number
          model: string | null
          outcome: string
          person_id: string | null
          photo_path: string
          reason: string | null
          source: string
        }
        Insert: {
          ai_cost_usd?: number
          at?: string
          duration_ms?: number | null
          error?: string | null
          id?: never
          model?: string | null
          outcome: string
          person_id?: string | null
          photo_path: string
          reason?: string | null
          source: string
        }
        Update: {
          ai_cost_usd?: number
          at?: string
          duration_ms?: number | null
          error?: string | null
          id?: never
          model?: string | null
          outcome?: string
          person_id?: string | null
          photo_path?: string
          reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_checks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_friends: {
        Row: {
          age_attested_at: string | null
          claim_token_hash: string
          claimed_at: string | null
          created_at: string
          first_name: string | null
          id: string
          pin_id: string
        }
        Insert: {
          age_attested_at?: string | null
          claim_token_hash: string
          claimed_at?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          pin_id: string
        }
        Update: {
          age_attested_at?: string | null
          claim_token_hash?: string
          claimed_at?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          pin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_friends_pin_id_fkey"
            columns: ["pin_id"]
            isOneToOne: false
            referencedRelation: "pins"
            referencedColumns: ["id"]
          },
        ]
      }
      pins: {
        Row: {
          created_at: string
          gathering_id: string
          id: string
          open_to_meeting: boolean
          party_total: number
          person_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gathering_id: string
          id?: string
          open_to_meeting?: boolean
          party_total?: number
          person_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gathering_id?: string
          id?: string
          open_to_meeting?: boolean
          party_total?: number
          person_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pins_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pins_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_decisions: {
        Row: {
          adjustment: number | null
          ai_score: number | null
          at: string
          candidates: number | null
          category: string | null
          city: string
          distance_km: number | null
          final_score: number | null
          gathering_id: string | null
          gathering_name: string
          id: number
          outcome: Database["public"]["Enums"]["publish_outcome"]
          publish_mark: Database["public"]["Enums"]["publish_mark"] | null
          published_before: number
          rank: number | null
          reason: string
          reason_code: string
          run_id: number | null
          slot: number | null
          slot_kind: string | null
          starts_at: string
          target: number
          venue_id: string | null
          venue_name: string | null
          week_start: string
        }
        Insert: {
          adjustment?: number | null
          ai_score?: number | null
          at?: string
          candidates?: number | null
          category?: string | null
          city: string
          distance_km?: number | null
          final_score?: number | null
          gathering_id?: string | null
          gathering_name: string
          id?: never
          outcome: Database["public"]["Enums"]["publish_outcome"]
          publish_mark?: Database["public"]["Enums"]["publish_mark"] | null
          published_before: number
          rank?: number | null
          reason: string
          reason_code: string
          run_id?: number | null
          slot?: number | null
          slot_kind?: string | null
          starts_at: string
          target: number
          venue_id?: string | null
          venue_name?: string | null
          week_start: string
        }
        Update: {
          adjustment?: number | null
          ai_score?: number | null
          at?: string
          candidates?: number | null
          category?: string | null
          city?: string
          distance_km?: number | null
          final_score?: number | null
          gathering_id?: string | null
          gathering_name?: string
          id?: never
          outcome?: Database["public"]["Enums"]["publish_outcome"]
          publish_mark?: Database["public"]["Enums"]["publish_mark"] | null
          published_before?: number
          rank?: number | null
          reason?: string
          reason_code?: string
          run_id?: number | null
          slot?: number | null
          slot_kind?: string | null
          starts_at?: string
          target?: number
          venue_id?: string | null
          venue_name?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_decisions_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "publish_decisions_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_decisions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_target_log: {
        Row: {
          applied: boolean
          at: string
          city: string
          decision: string
          from_target: number
          id: number
          inputs: Json
          median_pins: number | null
          min_lead_days: number
          organic_median_pins: number | null
          organic_qualifying: number
          organic_reach_rate: number | null
          qualifying: number
          reach_rate: number | null
          reason: string
          run_id: number | null
          seeded_median_pins: number | null
          seeded_qualifying: number
          seeded_reach_rate: number | null
          to_target: number
          week_start: string
          window_days: number
        }
        Insert: {
          applied: boolean
          at?: string
          city: string
          decision: string
          from_target: number
          id?: never
          inputs?: Json
          median_pins?: number | null
          min_lead_days: number
          organic_median_pins?: number | null
          organic_qualifying: number
          organic_reach_rate?: number | null
          qualifying: number
          reach_rate?: number | null
          reason: string
          run_id?: number | null
          seeded_median_pins?: number | null
          seeded_qualifying: number
          seeded_reach_rate?: number | null
          to_target: number
          week_start: string
          window_days: number
        }
        Update: {
          applied?: boolean
          at?: string
          city?: string
          decision?: string
          from_target?: number
          id?: never
          inputs?: Json
          median_pins?: number | null
          min_lead_days?: number
          organic_median_pins?: number | null
          organic_qualifying?: number
          organic_reach_rate?: number | null
          qualifying?: number
          reach_rate?: number | null
          reason?: string
          run_id?: number | null
          seeded_median_pins?: number | null
          seeded_qualifying?: number
          seeded_reach_rate?: number | null
          to_target?: number
          week_start?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "publish_target_log_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "publish_target_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          decision_note: string | null
          id: string
          is_safety: boolean | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_content_snapshot: string | null
          reporter_id: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_crew_id: string | null
          target_kind: Database["public"]["Enums"]["report_target"]
          target_message_id: string | null
          target_person_id: string | null
        }
        Insert: {
          created_at?: string
          decision_note?: string | null
          id?: string
          is_safety?: boolean | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_content_snapshot?: string | null
          reporter_id?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_crew_id?: string | null
          target_kind: Database["public"]["Enums"]["report_target"]
          target_message_id?: string | null
          target_person_id?: string | null
        }
        Update: {
          created_at?: string
          decision_note?: string | null
          id?: string
          is_safety?: boolean | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reported_content_snapshot?: string | null
          reporter_id?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_crew_id?: string | null
          target_kind?: Database["public"]["Enums"]["report_target"]
          target_message_id?: string | null
          target_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_crew_id_fkey"
            columns: ["target_crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_message_id_fkey"
            columns: ["target_message_id"]
            isOneToOne: false
            referencedRelation: "crew_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_person_id_fkey"
            columns: ["target_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      spot_suggestions: {
        Row: {
          address: string | null
          created_at: string
          decided_at: string | null
          description: string | null
          evidence_url: string | null
          id: string
          meeting_spot_id: string | null
          name: string
          reason: string | null
          status: Database["public"]["Enums"]["suggestion_status"]
          venue_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          decided_at?: string | null
          description?: string | null
          evidence_url?: string | null
          id?: string
          meeting_spot_id?: string | null
          name: string
          reason?: string | null
          status?: Database["public"]["Enums"]["suggestion_status"]
          venue_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          decided_at?: string | null
          description?: string | null
          evidence_url?: string | null
          id?: string
          meeting_spot_id?: string | null
          name?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["suggestion_status"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spot_suggestions_meeting_spot_id_fkey"
            columns: ["meeting_spot_id"]
            isOneToOne: false
            referencedRelation: "meeting_spots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spot_suggestions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      spot_votes: {
        Row: {
          created_at: string
          gathering_id: string
          gathering_spot_id: string
          person_id: string
        }
        Insert: {
          created_at?: string
          gathering_id: string
          gathering_spot_id: string
          person_id: string
        }
        Update: {
          created_at?: string
          gathering_id?: string
          gathering_spot_id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spot_votes_gathering_spot_fkey"
            columns: ["gathering_spot_id", "gathering_id"]
            isOneToOne: false
            referencedRelation: "gathering_spots"
            referencedColumns: ["id", "gathering_id"]
          },
          {
            foreignKeyName: "spot_votes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          anything_off: string | null
          created_at: string
          gathering_id: string
          id: string
          met: Database["public"]["Enums"]["survey_met"]
          person_id: string | null
          would_have_gone: Database["public"]["Enums"]["survey_would_have_gone"]
        }
        Insert: {
          anything_off?: string | null
          created_at?: string
          gathering_id: string
          id?: string
          met: Database["public"]["Enums"]["survey_met"]
          person_id?: string | null
          would_have_gone: Database["public"]["Enums"]["survey_would_have_gone"]
        }
        Update: {
          anything_off?: string | null
          created_at?: string
          gathering_id?: string
          id?: string
          met?: Database["public"]["Enums"]["survey_met"]
          person_id?: string | null
          would_have_gone?: Database["public"]["Enums"]["survey_would_have_gone"]
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          name: string
          slug: string
          sort_order: number
        }
        Update: {
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      venue_aliases: {
        Row: {
          alias: string
          alias_key: string | null
          created_at: string
          id: string
          venue_id: string
        }
        Insert: {
          alias: string
          alias_key?: string | null
          created_at?: string
          id?: string
          venue_id: string
        }
        Update: {
          alias?: string
          alias_key?: string | null
          created_at?: string
          id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_aliases_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_external_ids: {
        Row: {
          created_at: string
          external_id: string
          needs_review: boolean
          source: Database["public"]["Enums"]["gathering_source"]
          venue_id: string
        }
        Insert: {
          created_at?: string
          external_id: string
          needs_review?: boolean
          source: Database["public"]["Enums"]["gathering_source"]
          venue_id: string
        }
        Update: {
          created_at?: string
          external_id?: string
          needs_review?: boolean
          source?: Database["public"]["Enums"]["gathering_source"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_external_ids_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_map_renders: {
        Row: {
          attempts: number
          bytes: number | null
          last_error: string | null
          map_key: string
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          attempts?: number
          bytes?: number | null
          last_error?: string | null
          map_key: string
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          attempts?: number
          bytes?: number | null
          last_error?: string | null
          map_key?: string
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_map_renders_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          city: string
          created_at: string
          id: string
          is_seed: boolean
          latitude: number | null
          longitude: number | null
          map_image_path: string | null
          name: string
        }
        Insert: {
          address?: string | null
          city?: string
          created_at?: string
          id?: string
          is_seed?: boolean
          latitude?: number | null
          longitude?: number | null
          map_image_path?: string | null
          name: string
        }
        Update: {
          address?: string | null
          city?: string
          created_at?: string
          id?: string
          is_seed?: boolean
          latitude?: number | null
          longitude?: number | null
          map_image_path?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["slug"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_ai_spend_today: { Args: { p_city: string }; Returns: number }
      admin_alert_already_sent_today: {
        Args: { p_kind: string }
        Returns: boolean
      }
      admin_apply_publish_target: {
        Args: { p_actor: string; p_city: string; p_target: number }
        Returns: number
      }
      admin_approve_spot: {
        Args: {
          p_actor: string
          p_description: string
          p_name: string
          p_suggestion: string
        }
        Returns: string
      }
      admin_categorise_gatherings: { Args: never; Returns: number }
      admin_confirm_venue: {
        Args: { p_actor: string; p_venue: string }
        Returns: undefined
      }
      admin_create_series: {
        Args: {
          p_actor: string
          p_cadence: Database["public"]["Enums"]["series_cadence"]
          p_template: Json
          p_until: string
        }
        Returns: Json
      }
      admin_delete_pin: {
        Args: { p_actor: string; p_note?: string; p_pin: string }
        Returns: undefined
      }
      admin_delete_promotion: {
        Args: { p_actor: string; p_promotion: string }
        Returns: undefined
      }
      admin_dismiss_gathering: {
        Args: { p_actor: string; p_gathering: string }
        Returns: undefined
      }
      admin_dismiss_reports: {
        Args: { p_actor: string; p_note?: string; p_person: string }
        Returns: undefined
      }
      admin_hide_person: {
        Args: { p_actor: string; p_note?: string; p_person: string }
        Returns: undefined
      }
      admin_import_apply: {
        Args: { p_plan: Json; p_run: number }
        Returns: Json
      }
      admin_import_due: { Args: never; Returns: Json }
      admin_import_health: { Args: never; Returns: Json }
      admin_keep_hidden: {
        Args: { p_actor: string; p_note?: string; p_person: string }
        Returns: undefined
      }
      admin_merge_gatherings: {
        Args: { p_actor: string; p_loser: string; p_survivor: string }
        Returns: undefined
      }
      admin_merge_venues: {
        Args: { p_actor: string; p_from: string; p_into: string }
        Returns: undefined
      }
      admin_mint_slug: { Args: { p_gathering: string }; Returns: string }
      admin_photo_states: {
        Args: never
        Returns: {
          check_failing: number
          never_checked: number
          waiting_for_human: number
        }[]
      }
      admin_publish_gathering: {
        Args: { p_actor: string; p_gathering: string }
        Returns: undefined
      }
      admin_publish_outcomes: {
        Args: { p_city: string; p_days: number }
        Returns: Json
      }
      admin_purge_ticketmaster_data: {
        Args: { p_days?: number }
        Returns: Json
      }
      admin_record_alert: {
        Args: {
          p_error: string
          p_kind: string
          p_sent: boolean
          p_subject: string
        }
        Returns: undefined
      }
      admin_record_map_render: {
        Args: {
          p_bytes?: number
          p_error?: string
          p_key: string
          p_ok: boolean
          p_venue: string
        }
        Returns: number
      }
      admin_record_photo_check: {
        Args: {
          p_cost?: number
          p_duration_ms?: number
          p_error?: string
          p_model?: string
          p_outcome: string
          p_person: string
          p_photo_path: string
          p_reason?: string
          p_source: string
        }
        Returns: Database["public"]["Enums"]["photo_status"]
      }
      admin_record_promotion: {
        Args: {
          p_actor: string
          p_channel: string
          p_gathering: string
          p_note: string
        }
        Returns: string
      }
      admin_record_series_check: {
        Args: {
          p_cadence?: string
          p_confirmed_through?: string
          p_note?: string
          p_outcome: string
          p_series: string
          p_status?: string
        }
        Returns: undefined
      }
      admin_reject_spot: {
        Args: { p_actor: string; p_suggestion: string }
        Returns: undefined
      }
      admin_report_import_schedule: {
        Args: { p_cron: string; p_scheduled_time: string }
        Returns: undefined
      }
      admin_resolve_flag: {
        Args: { p_actor: string; p_flag: string; p_resolution: string }
        Returns: undefined
      }
      admin_restore_gathering: {
        Args: { p_actor: string; p_gathering: string }
        Returns: undefined
      }
      admin_save_publish_settings: {
        Args: { p_actor: string; p_city: string; p_settings: Json }
        Returns: undefined
      }
      admin_set_blurb: {
        Args: {
          p_actor: string
          p_blurb: string
          p_gathering: string
          p_source: string
          p_why: string
        }
        Returns: boolean
      }
      admin_set_photo_status: {
        Args: {
          p_actor: string
          p_person: string
          p_photo_path: string
          p_status: Database["public"]["Enums"]["photo_status"]
        }
        Returns: undefined
      }
      admin_set_publish_mark: {
        Args: { p_actor: string; p_gathering: string; p_mark: string }
        Returns: undefined
      }
      admin_set_slug: {
        Args: { p_actor: string; p_gathering: string; p_slug: string }
        Returns: string
      }
      admin_settle_series: {
        Args: { p_actor: string; p_note?: string; p_series: string }
        Returns: undefined
      }
      admin_start_check_run: {
        Args: { p_actor: string; p_city: string; p_trigger: string }
        Returns: number
      }
      admin_start_import_run: {
        Args: {
          p_actor: string
          p_city: string
          p_source: Database["public"]["Enums"]["gathering_source"]
          p_trigger: string
        }
        Returns: number
      }
      admin_top_up_spot_poll: {
        Args: { p_gathering: string }
        Returns: undefined
      }
      admin_unhide_person: {
        Args: { p_actor: string; p_note?: string; p_person: string }
        Returns: undefined
      }
      admin_unpublish_gathering: {
        Args: { p_actor: string; p_gathering: string }
        Returns: undefined
      }
      admin_unwithdraw_gathering: {
        Args: { p_actor: string; p_gathering: string }
        Returns: undefined
      }
      admin_venue_map_keys: {
        Args: never
        Returns: {
          coord_key: string
          venue_id: string
        }[]
      }
      admin_watchdog_import: { Args: never; Returns: Json }
      admin_withdraw_gathering: {
        Args: {
          p_actor: string
          p_gathering: string
          p_note: string
          p_reason: Database["public"]["Enums"]["withdraw_reason"]
        }
        Returns: undefined
      }
      chip_category: {
        Args: { p_classification: string }
        Returns: Database["public"]["Enums"]["gathering_category"]
      }
      effective_end: {
        Args: { g: Database["public"]["Tables"]["gatherings"]["Row"] }
        Returns: string
      }
      gathering_counts: {
        Args: { gathering_ids: string[] }
        Returns: {
          crews_open: boolean
          gathering_id: string
          men: number
          open_to_meeting: number
          other: number
          pinned: number
          women: number
        }[]
      }
      public_gathering: { Args: { p_slug: string }; Returns: Json }
      public_gatherings: {
        Args: { p_from: string; p_to: string }
        Returns: {
          blurb: string
          category: Database["public"]["Enums"]["gathering_category"]
          city_name: string
          city_timezone: string
          crews_open: boolean
          door_price_cents: number
          ends_at: string
          entry: Database["public"]["Enums"]["entry_kind"]
          entry_note: string
          name: string
          open_to_meeting: number
          pinned: number
          signup_required: boolean
          slug: string
          source: Database["public"]["Enums"]["gathering_source"]
          starts_at: string
          venue_id: string
          venue_name: string
        }[]
      }
      spot_poll: {
        Args: { p_gathering: string }
        Returns: {
          gathering_spot_id: string
          votes: number
        }[]
      }
      venue_map_key: { Args: { p_lat: number; p_lng: number }; Returns: string }
      women_only_offer: { Args: { p_gathering: string }; Returns: boolean }
    }
    Enums: {
      confirmation_kind: "we_met" | "keep_in_touch"
      contact_kind: "email" | "sms"
      crew_state: "forming" | "spot_set" | "live" | "done" | "dissolved"
      entry_kind: "free" | "door" | "ticketed"
      gathering_category:
        | "live_music"
        | "sport"
        | "comedy"
        | "games"
        | "cycling"
        | "running"
        | "outdoors"
        | "markets"
      gathering_flag_kind:
        | "date_changed"
        | "rescheduled"
        | "postponed"
        | "cancelled"
        | "missing"
      gathering_source: "ticketmaster" | "manual" | "ai"
      gender: "woman" | "man" | "nonbinary" | "undisclosed"
      group_link_kind: "everyone" | "women_only"
      join_request_status: "pending" | "approved" | "declined"
      message_kind: "system" | "user" | "arrival"
      outbound_kind: "threshold" | "survey"
      photo_status: "pending" | "approved" | "needs_review" | "rejected"
      publish_mark: "publish" | "never"
      publish_outcome: "published" | "skipped"
      report_reason: "uncomfortable" | "not_who_they_said" | "under_19" | "spam"
      report_status: "open" | "auto_hidden" | "actioned" | "dismissed"
      report_target: "person" | "crew" | "message"
      series_cadence: "weekly" | "fortnightly" | "monthly"
      suggestion_status: "pending" | "approved" | "rejected"
      survey_met: "none" | "1_2" | "3_5" | "6_plus"
      survey_would_have_gone: "yes" | "no" | "wasnt_going"
      withdraw_reason: "cancelled" | "postponed" | "takedown" | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      confirmation_kind: ["we_met", "keep_in_touch"],
      contact_kind: ["email", "sms"],
      crew_state: ["forming", "spot_set", "live", "done", "dissolved"],
      entry_kind: ["free", "door", "ticketed"],
      gathering_category: [
        "live_music",
        "sport",
        "comedy",
        "games",
        "cycling",
        "running",
        "outdoors",
        "markets",
      ],
      gathering_flag_kind: [
        "date_changed",
        "rescheduled",
        "postponed",
        "cancelled",
        "missing",
      ],
      gathering_source: ["ticketmaster", "manual", "ai"],
      gender: ["woman", "man", "nonbinary", "undisclosed"],
      group_link_kind: ["everyone", "women_only"],
      join_request_status: ["pending", "approved", "declined"],
      message_kind: ["system", "user", "arrival"],
      outbound_kind: ["threshold", "survey"],
      photo_status: ["pending", "approved", "needs_review", "rejected"],
      publish_mark: ["publish", "never"],
      publish_outcome: ["published", "skipped"],
      report_reason: ["uncomfortable", "not_who_they_said", "under_19", "spam"],
      report_status: ["open", "auto_hidden", "actioned", "dismissed"],
      report_target: ["person", "crew", "message"],
      series_cadence: ["weekly", "fortnightly", "monthly"],
      suggestion_status: ["pending", "approved", "rejected"],
      survey_met: ["none", "1_2", "3_5", "6_plus"],
      survey_would_have_gone: ["yes", "no", "wasnt_going"],
      withdraw_reason: ["cancelled", "postponed", "takedown", "other"],
    },
  },
} as const
