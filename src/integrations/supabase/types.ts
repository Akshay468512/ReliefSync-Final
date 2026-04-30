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
      emergency_requests: {
        Row: {
          address: string | null
          ai_summary: string | null
          ai_score: number
          created_at: string
          description: string
          disaster_type: Database["public"]["Enums"]["disaster_type"]
          id: string
          latitude: number
          longitude: number
          need_type: Database["public"]["Enums"]["need_type"]
          people_affected: number
          photo_url: string | null
          reporter_id: string | null
          reporter_name: string
          reporter_phone: string
          resolved_place_name: string | null
          status: Database["public"]["Enums"]["request_status"]
          triage_summary: string | null
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"]
        }
        Insert: {
          address?: string | null
          ai_summary?: string | null
          ai_score?: number
          created_at?: string
          description?: string
          disaster_type: Database["public"]["Enums"]["disaster_type"]
          id?: string
          latitude: number
          longitude: number
          need_type: Database["public"]["Enums"]["need_type"]
          people_affected?: number
          photo_url?: string | null
          reporter_id?: string | null
          reporter_name: string
          reporter_phone: string
          resolved_place_name?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          triage_summary?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Update: {
          address?: string | null
          ai_summary?: string | null
          ai_score?: number
          created_at?: string
          description?: string
          disaster_type?: Database["public"]["Enums"]["disaster_type"]
          id?: string
          latitude?: number
          longitude?: number
          need_type?: Database["public"]["Enums"]["need_type"]
          people_affected?: number
          photo_url?: string | null
          reporter_id?: string | null
          reporter_name?: string
          reporter_phone?: string
          resolved_place_name?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          triage_summary?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Relationships: []
      }
      missions: {
        Row: {
          alternate_route_polyline: Json | null
          arrived_at: string | null
          completed_at: string | null
          created_at: string
          eta_minutes: number | null
          id: string
          latest_volunteer_lat: number | null
          latest_volunteer_lng: number | null
          notes: string | null
          request_id: string
          route_distance_km: number | null
          route_duration_minutes: number | null
          route_mode: string | null
          route_polyline: Json | null
          route_summary: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["mission_status"]
          updated_at: string
          volunteer_id: string
          volunteer_start_lat: number | null
          volunteer_start_lng: number | null
          volunteer_name: string
        }
        Insert: {
          alternate_route_polyline?: Json | null
          arrived_at?: string | null
          completed_at?: string | null
          created_at?: string
          eta_minutes?: number | null
          id?: string
          latest_volunteer_lat?: number | null
          latest_volunteer_lng?: number | null
          notes?: string | null
          request_id: string
          route_distance_km?: number | null
          route_duration_minutes?: number | null
          route_mode?: string | null
          route_polyline?: Json | null
          route_summary?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["mission_status"]
          updated_at?: string
          volunteer_id: string
          volunteer_start_lat?: number | null
          volunteer_start_lng?: number | null
          volunteer_name: string
        }
        Update: {
          alternate_route_polyline?: Json | null
          arrived_at?: string | null
          completed_at?: string | null
          created_at?: string
          eta_minutes?: number | null
          id?: string
          latest_volunteer_lat?: number | null
          latest_volunteer_lng?: number | null
          notes?: string | null
          request_id?: string
          route_distance_km?: number | null
          route_duration_minutes?: number | null
          route_mode?: string | null
          route_polyline?: Json | null
          route_summary?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["mission_status"]
          updated_at?: string
          volunteer_id?: string
          volunteer_start_lat?: number | null
          volunteer_start_lng?: number | null
          volunteer_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "missions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "emergency_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          has_vehicle: boolean | null
          id: string
          phone: string | null
          skills: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          has_vehicle?: boolean | null
          id: string
          phone?: string | null
          skills?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          has_vehicle?: boolean | null
          id?: string
          phone?: string | null
          skills?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "citizen" | "volunteer" | "admin"
      disaster_type:
        | "flood"
        | "earthquake"
        | "cyclone"
        | "fire"
        | "medical"
        | "other"
      mission_status: "accepted" | "on_the_way" | "completed" | "cancelled"
      need_type:
        | "food"
        | "medicine"
        | "rescue"
        | "blood"
        | "shelter"
        | "transport"
      request_status:
        | "open"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled"
      urgency_level: "low" | "medium" | "high" | "critical"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["citizen", "volunteer", "admin"],
      disaster_type: [
        "flood",
        "earthquake",
        "cyclone",
        "fire",
        "medical",
        "other",
      ],
      mission_status: ["accepted", "on_the_way", "completed", "cancelled"],
      need_type: [
        "food",
        "medicine",
        "rescue",
        "blood",
        "shelter",
        "transport",
      ],
      request_status: [
        "open",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
      ],
      urgency_level: ["low", "medium", "high", "critical"],
    },
  },
} as const
