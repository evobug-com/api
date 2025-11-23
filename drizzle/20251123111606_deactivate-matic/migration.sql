-- Custom SQL migration file, put your code below! --

-- Deactivate MATIC/USD as it's no longer available in Twelve Data API
UPDATE public.investment_assets
SET "isActive" = false,
    "updatedAt" = NOW()
WHERE "symbol" = 'MATIC';
