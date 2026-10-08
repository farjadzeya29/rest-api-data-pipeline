export type PipelineStage = 
  | 'idle' 
  | 'extracting' 
  | 'validating' 
  | 'transforming' 
  | 'checking_dq' 
  | 'loading_db' 
  | 'completed' 
  | 'failed';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  logger: string;
  message: string;
}

export interface RawProduct {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;
  discountPercentage: number;
  rating: number;
  stock: number;
  brand?: string;
  sku?: string;
  weight?: number;
  dimensions?: {
    width: number;
    height: number;
    depth: number;
  };
  reviews?: Array<{
    rating: number;
    comment: string;
    date: string;
    reviewerName: string;
    reviewerEmail: string;
  }>;
  meta?: {
    barcode?: string;
  };
  warrantyInformation?: string;
  shippingInformation?: string;
  availabilityStatus?: string;
  returnPolicy?: string;
  minimumOrderQuantity?: number;
}

export interface TransformedProduct {
  product_id: number;
  sku: string;
  title: string;
  description: string;
  category_code: string;
  brand_name: string | null;
  price: number;
  discount_percentage: number;
  discounted_price: number;
  rating: number;
  stock: number;
  stock_status: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';
  weight_grams: number | null;
  warranty_information: string;
  shipping_information: string;
  availability_status: string;
  return_policy: string;
  minimum_order_quantity: number;
  barcode: string | null;
}

export interface TransformedCategory {
  category_id?: number;
  category_code: string;
  category_name: string;
}

export interface TransformedBrand {
  brand_id?: number;
  brand_name: string;
}

export interface TransformedDimension {
  product_id: number;
  width_cm: number;
  height_cm: number;
  depth_cm: number;
  volume_cm3: number;
}

export interface TransformedReview {
  review_id?: number;
  product_id: number;
  reviewer_name: string;
  reviewer_email: string;
  rating: number;
  comment: string;
  review_date: string;
}

export interface DQCheckResult {
  check_name: string;
  target_table: string;
  severity: 'CRITICAL' | 'WARNING';
  status: 'PASSED' | 'FAILED';
  message: string;
  metrics: Record<string, any>;
}

export interface AuditRunRecord {
  run_id: string;
  pipeline_name: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  records_extracted: number;
  records_validated: number;
  records_transformed: number;
  records_inserted: number;
  records_updated: number;
  dq_passed_count: number;
  dq_failed_count: number;
  execution_duration_sec: number;
  started_at: string;
  completed_at: string;
}
