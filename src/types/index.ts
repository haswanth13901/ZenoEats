export type OrderStatus =
  | "placed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  logo_url: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
}

export interface Place {
  id: string;
  restaurant_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  photo_url: string | null;
  category: string | null;
  is_available: boolean;
}

export interface Order {
  id: string;
  restaurant_id: string;
  place_id: string;
  driver_id: string | null;
  status: OrderStatus;
  customer_phone: string | null;
  total_cents: number;
  paid: boolean;
  created_at: string;
}

export interface CartItem {
  menu_item_id: string;
  name: string;
  price_cents: number;
  quantity: number;
}
