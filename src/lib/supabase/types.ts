export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string
          role: 'admin' | 'player' | 'investor'
          created_at: string | null
        }
        Insert: {
          id: string
          email: string
          name: string
          role: 'admin' | 'player' | 'investor'
          created_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          name?: string
          role?: 'admin' | 'player' | 'investor'
          created_at?: string | null
        }
        Relationships: []
      }
      players: {
        Row: {
          id: string
          user_id: string | null
          name: string
          eu_tier_mode: 'A' | 'B' | null
          intro_tier_mode: 'A' | 'B' | null
          introduced_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          eu_tier_mode?: 'A' | 'B' | null
          intro_tier_mode?: 'A' | 'B' | null
          introduced_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          name?: string
          eu_tier_mode?: 'A' | 'B' | null
          intro_tier_mode?: 'A' | 'B' | null
          introduced_by?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_introduced_by_fkey"
            columns: ["introduced_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      investors: {
        Row: {
          id: string
          user_id: string | null
          name: string
          capital: number
          date_joined: string | null
          introduced_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          capital?: number
          date_joined?: string | null
          introduced_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          name?: string
          capital?: number
          date_joined?: string | null
          introduced_by?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investors_introduced_by_fkey"
            columns: ["introduced_by"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          id: string
          ref: string
          channel: 'punchout' | 'gep'
          end_user_id: string
          po_date: string
          po_amount: number
          commissions_cleared: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          ref: string
          channel: 'punchout' | 'gep'
          end_user_id: string
          po_date: string
          po_amount?: number
          commissions_cleared?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          ref?: string
          channel?: 'punchout' | 'gep'
          end_user_id?: string
          po_date?: string
          po_amount?: number
          commissions_cleared?: string | null
          created_at?: string | null
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
      delivery_orders: {
        Row: {
          id: string
          po_id: string
          ref: string
          description: string | null
          amount: number
          delivery: 'local' | 'sea' | 'international' | null
          urgency: 'normal' | 'urgent' | 'rush' | null
          supplier_paid: string | null
          delivered: string | null
          invoiced: string | null
          buyer_paid: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          po_id: string
          ref: string
          description?: string | null
          amount?: number
          delivery?: 'local' | 'sea' | 'international' | null
          urgency?: 'normal' | 'urgent' | 'rush' | null
          supplier_paid?: string | null
          delivered?: string | null
          invoiced?: string | null
          buyer_paid?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          po_id?: string
          ref?: string
          description?: string | null
          amount?: number
          delivery?: 'local' | 'sea' | 'international' | null
          urgency?: 'normal' | 'urgent' | 'rush' | null
          supplier_paid?: string | null
          delivered?: string | null
          invoiced?: string | null
          buyer_paid?: string | null
          created_at?: string | null
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
      opex: {
        Row: {
          id: string
          month: string
          rental: number | null
          salary: number | null
          utilities: number | null
          others: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          month: string
          rental?: number | null
          salary?: number | null
          utilities?: number | null
          others?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          month?: string
          rental?: number | null
          salary?: number | null
          utilities?: number | null
          others?: number | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type InsertDto<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type UpdateDto<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
