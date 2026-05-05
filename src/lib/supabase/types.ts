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
      admin_adjustments: {
        Row: {
          adjusted_by: string | null
          amount: number
          created_at: string | null
          id: string
          investor_id: string
          reason: string | null
        }
        Insert: {
          adjusted_by?: string | null
          amount: number
          created_at?: string | null
          id?: string
          investor_id: string
          reason?: string | null
        }
        Update: {
          adjusted_by?: string | null
          amount?: number
          created_at?: string | null
          id?: string
          investor_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_adjustments_adjusted_by_fkey"
            columns: ["adjusted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_adjustments_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_orders: {
        Row: {
          amount: number
          buyer_paid: string | null
          created_at: string | null
          delivered: string | null
          delivery: string | null
          description: string | null
          id: string
          invoiced: string | null
          po_id: string
          ref: string
          supplier_paid: string | null
        }
        Insert: {
          amount?: number
          buyer_paid?: string | null
          created_at?: string | null
          delivered?: string | null
          delivery?: string | null
          description?: string | null
          id?: string
          invoiced?: string | null
          po_id: string
          ref: string
          supplier_paid?: string | null
        }
        Update: {
          amount?: number
          buyer_paid?: string | null
          created_at?: string | null
          delivered?: string | null
          delivery?: string | null
          description?: string | null
          id?: string
          invoiced?: string | null
          po_id?: string
          ref?: string
          supplier_paid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_orders_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_requests: {
        Row: {
          admin_notes: string | null
          amount: number
          created_at: string | null
          deposit_id: string | null
          deposited_at: string | null
          id: string
          investor_id: string
          method: string | null
          notes: string | null
          processed_at: string | null
          reference: string | null
          requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          created_at?: string | null
          deposit_id?: string | null
          deposited_at?: string | null
          id?: string
          investor_id: string
          method?: string | null
          notes?: string | null
          processed_at?: string | null
          reference?: string | null
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          created_at?: string | null
          deposit_id?: string | null
          deposited_at?: string | null
          id?: string
          investor_id?: string
          method?: string | null
          notes?: string | null
          processed_at?: string | null
          reference?: string | null
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_requests_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_requests_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          amount: number
          created_at: string | null
          deposited_at: string
          id: string
          investor_id: string
          method: string | null
          notes: string | null
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          deposited_at: string
          id?: string
          investor_id: string
          method?: string | null
          notes?: string | null
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          deposited_at?: string
          id?: string
          investor_id?: string
          method?: string | null
          notes?: string | null
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      introducer_credits: {
        Row: {
          amount: number
          base_return: number
          created_at: string
          id: string
          introducee_id: string
          introducer_id: string
          po_id: string
          tier_rate: number
        }
        Insert: {
          amount: number
          base_return: number
          created_at?: string
          id?: string
          introducee_id: string
          introducer_id: string
          po_id: string
          tier_rate: number
        }
        Update: {
          amount?: number
          base_return?: number
          created_at?: string
          id?: string
          introducee_id?: string
          introducer_id?: string
          po_id?: string
          tier_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "introducer_credits_introducee_id_fkey"
            columns: ["introducee_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "introducer_credits_introducer_id_fkey"
            columns: ["introducer_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "introducer_credits_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      introducer_credits_backup_012: {
        Row: {
          amount: number
          base_return: number
          created_at: string
          id: string
          introducee_id: string
          introducer_id: string
          po_id: string
          tier_rate: number
        }
        Insert: {
          amount: number
          base_return: number
          created_at?: string
          id?: string
          introducee_id: string
          introducer_id: string
          po_id: string
          tier_rate: number
        }
        Update: {
          amount?: number
          base_return?: number
          created_at?: string
          id?: string
          introducee_id?: string
          introducer_id?: string
          po_id?: string
          tier_rate?: number
        }
        Relationships: []
      }
      investors: {
        Row: {
          capital: number
          created_at: string | null
          date_joined: string | null
          id: string
          introduced_by: string | null
          name: string
          user_id: string | null
        }
        Insert: {
          capital?: number
          created_at?: string | null
          date_joined?: string | null
          id?: string
          introduced_by?: string | null
          name: string
          user_id?: string | null
        }
        Update: {
          capital?: number
          created_at?: string | null
          date_joined?: string | null
          id?: string
          introduced_by?: string | null
          name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investors_introduced_by_fkey"
            columns: ["introduced_by"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      opex: {
        Row: {
          created_at: string | null
          id: string
          month: string
          others: number | null
          rental: number | null
          salary: number | null
          utilities: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          month: string
          others?: number | null
          rental?: number | null
          salary?: number | null
          utilities?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          month?: string
          others?: number | null
          rental?: number | null
          salary?: number | null
          utilities?: number | null
        }
        Relationships: []
      }
      player_commissions: {
        Row: {
          amount: number
          base_amount: number | null
          created_at: string
          id: string
          is_split: boolean
          player_id: string
          po_id: string
          tier_rate: number
          type: string
          withdrawal_id: string | null
        }
        Insert: {
          amount: number
          base_amount?: number | null
          created_at?: string
          id?: string
          is_split?: boolean
          player_id: string
          po_id: string
          tier_rate: number
          type: string
          withdrawal_id?: string | null
        }
        Update: {
          amount?: number
          base_amount?: number | null
          created_at?: string
          id?: string
          is_split?: boolean
          player_id?: string
          po_id?: string
          tier_rate?: number
          type?: string
          withdrawal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_commissions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_commissions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_commissions_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "player_withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      player_loss_debits: {
        Row: {
          amount: number
          base_amount: number | null
          cleared_at: string
          created_at: string
          id: string
          introducee_id: string | null
          player_id: string
          po_id: string
          tier_rate: number
          type: string
        }
        Insert: {
          amount: number
          base_amount?: number | null
          cleared_at: string
          created_at?: string
          id?: string
          introducee_id?: string | null
          player_id: string
          po_id: string
          tier_rate: number
          type: string
        }
        Update: {
          amount?: number
          base_amount?: number | null
          cleared_at?: string
          created_at?: string
          id?: string
          introducee_id?: string | null
          player_id?: string
          po_id?: string
          tier_rate?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_loss_debits_introducee_id_fkey"
            columns: ["introducee_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_loss_debits_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_loss_debits_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      player_withdrawals: {
        Row: {
          admin_notes: string | null
          amount: number
          created_at: string
          id: string
          notes: string | null
          paid_at: string | null
          player_id: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          player_id: string
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          player_id?: string
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_withdrawals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_withdrawals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string | null
          eu_tier_mode_grid: string
          eu_tier_mode_proxy: string
          id: string
          intro_tier_mode_grid: string
          intro_tier_mode_proxy: string
          introduced_by: string | null
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          eu_tier_mode_grid?: string
          eu_tier_mode_proxy?: string
          id?: string
          intro_tier_mode_grid?: string
          intro_tier_mode_proxy?: string
          introduced_by?: string | null
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          eu_tier_mode_grid?: string
          eu_tier_mode_proxy?: string
          id?: string
          intro_tier_mode_grid?: string
          intro_tier_mode_proxy?: string
          introduced_by?: string | null
          name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_introduced_by_fkey"
            columns: ["introduced_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          channel: string
          commissions_cleared: string | null
          created_at: string | null
          description: string | null
          end_user_id: string
          id: string
          note: string | null
          other_cost: number
          other_cost_reason: string | null
          po_amount: number
          po_date: string
          ref: string
        }
        Insert: {
          channel: string
          commissions_cleared?: string | null
          created_at?: string | null
          description?: string | null
          end_user_id: string
          id?: string
          note?: string | null
          other_cost?: number
          other_cost_reason?: string | null
          po_amount?: number
          po_date: string
          ref: string
        }
        Update: {
          channel?: string
          commissions_cleared?: string | null
          created_at?: string | null
          description?: string | null
          end_user_id?: string
          id?: string
          note?: string | null
          other_cost?: number
          other_cost_reason?: string | null
          po_amount?: number
          po_date?: string
          ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_end_user_id_fkey"
            columns: ["end_user_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      return_credits: {
        Row: {
          amount: number
          created_at: string | null
          deployed: number
          id: string
          investor_id: string
          po_id: string
          tier_rate: number
        }
        Insert: {
          amount: number
          created_at?: string | null
          deployed?: number
          id?: string
          investor_id: string
          po_id: string
          tier_rate?: number
        }
        Update: {
          amount?: number
          created_at?: string | null
          deployed?: number
          id?: string
          investor_id?: string
          po_id?: string
          tier_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_credits_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_credits_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      return_credits_backup_010: {
        Row: {
          amount: number | null
          created_at: string | null
          deployed: number | null
          id: string | null
          investor_id: string | null
          po_id: string | null
          tier_rate: number | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          deployed?: number | null
          id?: string | null
          investor_id?: string | null
          po_id?: string | null
          tier_rate?: number | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          deployed?: number | null
          id?: string | null
          investor_id?: string | null
          po_id?: string | null
          tier_rate?: number | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          name: string
          role: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          name: string
          role: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          role?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          investor_id: string
          notes: string | null
          processed_at: string | null
          requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          investor_id: string
          notes?: string | null
          processed_at?: string | null
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          investor_id?: string
          notes?: string | null
          processed_at?: string | null
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_deposit_events: {
        Row: {
          amount: number | null
          deposited_at: string | null
          investor_id: string | null
        }
        Insert: {
          amount?: number | null
          deposited_at?: string | null
          investor_id?: string | null
        }
        Update: {
          amount?: number | null
          deposited_at?: string | null
          investor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_introducer_credit_events: {
        Row: {
          amount: number | null
          created_at: string | null
          introducer_id: string | null
          po_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          introducer_id?: string | null
          po_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          introducer_id?: string | null
          po_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "introducer_credits_introducer_id_fkey"
            columns: ["introducer_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "introducer_credits_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      v_investor_ledger: {
        Row: {
          amount: number | null
          at: string | null
          balance_after: number | null
          investor_id: string | null
          kind: string | null
          notes: string | null
          ref: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      adjust_capital: {
        Args: {
          p_investor_id: string
          p_new_capital: number
          p_reason?: string
        }
        Returns: Json
      }
      approve_deposit_request: {
        Args: {
          p_admin_notes?: string
          p_deposited_at?: string
          p_request_id: string
        }
        Returns: Json
      }
      approve_player_withdrawal: {
        Args: { p_admin_notes?: string; p_withdrawal_id: string }
        Returns: Json
      }
      approve_withdrawal: {
        Args: { p_admin_notes?: string; p_withdrawal_id: string }
        Returns: Json
      }
      credit_introducer_commission: {
        Args: {
          p_amount: number
          p_base_return: number
          p_credit_date?: string
          p_introducee_id: string
          p_introducer_id: string
          p_po_id: string
          p_tier_rate: number
        }
        Returns: Json
      }
      credit_investor_return: {
        Args: {
          p_amount: number
          p_credit_date?: string
          p_deployed: number
          p_investor_id: string
          p_po_id: string
          p_tier_rate: number
        }
        Returns: Json
      }
      credit_player_commission: {
        Args: {
          p_amount: number
          p_base_amount?: number
          p_credit_date?: string
          p_player_id: string
          p_po_id: string
          p_tier_rate: number
          p_type: string
        }
        Returns: Json
      }
      credit_player_loss_debit: {
        Args: {
          p_amount: number
          p_base_amount?: number
          p_cleared_at?: string
          p_introducee_id?: string
          p_player_id: string
          p_po_id: string
          p_tier_rate: number
          p_type: string
        }
        Returns: Json
      }
      get_my_player_ids: { Args: never; Returns: string[] }
      get_my_recruit_ids: { Args: never; Returns: string[] }
      mark_player_withdrawal_paid: {
        Args: { p_admin_notes?: string; p_withdrawal_id: string }
        Returns: Json
      }
      record_deposit: {
        Args: {
          p_amount: number
          p_deposited_at: string
          p_investor_id: string
          p_method?: string
          p_notes?: string
          p_reference?: string
        }
        Returns: Json
      }
      reject_deposit_request: {
        Args: { p_admin_notes?: string; p_request_id: string }
        Returns: Json
      }
      reject_player_withdrawal: {
        Args: { p_admin_notes?: string; p_withdrawal_id: string }
        Returns: Json
      }
      reject_withdrawal: {
        Args: { p_admin_notes?: string; p_withdrawal_id: string }
        Returns: Json
      }
      submit_deposit_request: {
        Args: {
          p_amount: number
          p_investor_id: string
          p_method?: string
          p_notes?: string
          p_reference?: string
        }
        Returns: Json
      }
      submit_player_withdrawal: {
        Args: { p_amount: number; p_notes?: string; p_player_id: string }
        Returns: Json
      }
      submit_withdrawal: {
        Args: { p_amount: number; p_investor_id: string; p_type?: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
