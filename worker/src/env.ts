export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  PDF_BUCKET: R2Bucket;
  AI: Ai;
  BROWSER: Fetcher;
  OPENROUTER_API_KEY: string;
  ADMIN_API_KEY: string;
  INGEST_API_KEY: string;
  ENVIRONMENT: string;
  ADMIN_HOSTNAME: string;
}
