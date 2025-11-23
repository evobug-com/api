-- Custom SQL migration file, put your code below! --

-- Seed investment assets for educational stock/crypto trading
-- Total: 90 assets (60 US stocks + 20 crypto + 10 international)

-- US Stocks - Technology (20)
INSERT INTO public.investment_assets (symbol, name, "assetType", exchange, currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('AAPL', 'Apple Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'AAPL', true, 100, 'Consumer electronics and software'),
('MSFT', 'Microsoft Corporation', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'MSFT', true, 100, 'Software and cloud computing'),
('GOOGL', 'Alphabet Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'GOOGL', true, 100, 'Search engine and digital advertising'),
('AMZN', 'Amazon.com Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'AMZN', true, 100, 'E-commerce and cloud services'),
('NVDA', 'NVIDIA Corporation', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'NVDA', true, 100, 'Graphics processing units and AI chips'),
('META', 'Meta Platforms Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'META', true, 100, 'Social media and virtual reality'),
('TSLA', 'Tesla Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'TSLA', true, 100, 'Electric vehicles and clean energy'),
('AMD', 'Advanced Micro Devices', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'AMD', true, 100, 'Semiconductors and processors'),
('INTC', 'Intel Corporation', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'INTC', true, 100, 'Semiconductor manufacturing'),
('NFLX', 'Netflix Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'NFLX', true, 100, 'Streaming entertainment'),
('ORCL', 'Oracle Corporation', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'ORCL', true, 100, 'Database software and cloud'),
('CSCO', 'Cisco Systems', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'CSCO', true, 100, 'Networking equipment'),
('ADBE', 'Adobe Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'ADBE', true, 100, 'Creative software and digital marketing'),
('CRM', 'Salesforce Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'CRM', true, 100, 'Customer relationship management'),
('QCOM', 'Qualcomm Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'QCOM', true, 100, 'Mobile chip technology'),
('IBM', 'IBM Corporation', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'IBM', true, 100, 'Enterprise computing and AI'),
('UBER', 'Uber Technologies', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'UBER', true, 100, 'Ride-sharing and delivery'),
('SPOT', 'Spotify Technology', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'SPOT', true, 100, 'Music streaming service'),
('RBLX', 'Roblox Corporation', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'RBLX', true, 100, 'Online gaming platform'),
('SNOW', 'Snowflake Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'SNOW', true, 100, 'Cloud data platform');

-- US Stocks - Finance (10)
INSERT INTO public.investment_assets (symbol, name, "assetType", exchange, currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('JPM', 'JPMorgan Chase', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'JPM', true, 100, 'Banking and financial services'),
('BAC', 'Bank of America', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'BAC', true, 100, 'Consumer and commercial banking'),
('WFC', 'Wells Fargo', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'WFC', true, 100, 'Banking and financial services'),
('GS', 'Goldman Sachs', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'GS', true, 100, 'Investment banking'),
('MS', 'Morgan Stanley', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'MS', true, 100, 'Investment banking and wealth management'),
('V', 'Visa Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'V', true, 100, 'Payment processing'),
('MA', 'Mastercard Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'MA', true, 100, 'Payment processing'),
('PYPL', 'PayPal Holdings', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'PYPL', true, 100, 'Digital payments'),
('SQ', 'Block Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'SQ', true, 100, 'Financial services and Bitcoin'),
('AXP', 'American Express', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'AXP', true, 100, 'Credit cards and financial services');

-- US Stocks - Consumer (15)
INSERT INTO public.investment_assets (symbol, name, "assetType", exchange, currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('WMT', 'Walmart Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'WMT', true, 100, 'Retail and e-commerce'),
('HD', 'Home Depot', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'HD', true, 100, 'Home improvement retail'),
('MCD', 'McDonald''s Corporation', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'MCD', true, 100, 'Fast food restaurants'),
('NKE', 'Nike Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'NKE', true, 100, 'Athletic footwear and apparel'),
('SBUX', 'Starbucks Corporation', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'SBUX', true, 100, 'Coffee shops and beverages'),
('KO', 'Coca-Cola Company', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'KO', true, 100, 'Beverages'),
('PEP', 'PepsiCo Inc.', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'PEP', true, 100, 'Beverages and snacks'),
('DIS', 'Walt Disney Company', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'DIS', true, 100, 'Entertainment and media'),
('COST', 'Costco Wholesale', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'COST', true, 100, 'Warehouse retail'),
('TGT', 'Target Corporation', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'TGT', true, 100, 'Retail stores'),
('LULU', 'Lululemon Athletica', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'LULU', true, 100, 'Athletic apparel'),
('CMG', 'Chipotle Mexican Grill', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'CMG', true, 100, 'Fast casual restaurants'),
('YUM', 'Yum! Brands', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'YUM', true, 100, 'Restaurant franchises (KFC, Taco Bell)'),
('GM', 'General Motors', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'GM', true, 100, 'Automotive manufacturing'),
('F', 'Ford Motor Company', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'F', true, 100, 'Automotive manufacturing');

-- US Stocks - Healthcare & Energy (10)
INSERT INTO public.investment_assets (symbol, name, "assetType", exchange, currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('JNJ', 'Johnson & Johnson', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'JNJ', true, 100, 'Pharmaceuticals and medical devices'),
('PFE', 'Pfizer Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'PFE', true, 100, 'Pharmaceutical company'),
('UNH', 'UnitedHealth Group', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'UNH', true, 100, 'Health insurance'),
('CVS', 'CVS Health', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'CVS', true, 100, 'Pharmacy and healthcare'),
('ABBV', 'AbbVie Inc.', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'ABBV', true, 100, 'Biopharmaceuticals'),
('XOM', 'Exxon Mobil', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'XOM', true, 100, 'Oil and gas'),
('CVX', 'Chevron Corporation', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'CVX', true, 100, 'Oil and gas'),
('NEE', 'NextEra Energy', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'NEE', true, 100, 'Clean energy utility'),
('BA', 'Boeing Company', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'BA', true, 100, 'Aerospace manufacturing'),
('LMT', 'Lockheed Martin', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'LMT', true, 100, 'Defense and aerospace');

-- US Stocks - Index ETFs (5)
INSERT INTO public.investment_assets (symbol, name, "assetType", exchange, currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('SPY', 'SPDR S&P 500 ETF', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'SPY', true, 100, 'S&P 500 index fund'),
('QQQ', 'Invesco QQQ Trust', 'stock_us', 'NASDAQ', 'USD', 'twelvedata', 'QQQ', true, 100, 'NASDAQ-100 index fund'),
('DIA', 'SPDR Dow Jones ETF', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'DIA', true, 100, 'Dow Jones index fund'),
('IWM', 'iShares Russell 2000', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'IWM', true, 100, 'Small-cap index fund'),
('VTI', 'Vanguard Total Stock', 'stock_us', 'NYSE', 'USD', 'twelvedata', 'VTI', true, 100, 'Total US market index');

-- International Stocks (10)
INSERT INTO public.investment_assets (symbol, name, "assetType", exchange, currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('TSM', 'Taiwan Semiconductor', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'TSM', true, 100, 'Semiconductor manufacturing (Taiwan)'),
('BABA', 'Alibaba Group', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'BABA', true, 100, 'E-commerce and cloud (China)'),
('NVO', 'Novo Nordisk', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'NVO', true, 100, 'Pharmaceuticals (Denmark)'),
('ASML', 'ASML Holding', 'stock_intl', 'NASDAQ', 'USD', 'twelvedata', 'ASML', true, 100, 'Semiconductor equipment (Netherlands)'),
('SAP', 'SAP SE', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'SAP', true, 100, 'Enterprise software (Germany)'),
('TM', 'Toyota Motor', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'TM', true, 100, 'Automotive (Japan)'),
('SONY', 'Sony Group', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'SONY', true, 100, 'Electronics and entertainment (Japan)'),
('NVS', 'Novartis AG', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'NVS', true, 100, 'Pharmaceuticals (Switzerland)'),
('UL', 'Unilever PLC', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'UL', true, 100, 'Consumer goods (UK/Netherlands)'),
('SHOP', 'Shopify Inc.', 'stock_intl', 'NYSE', 'USD', 'twelvedata', 'SHOP', true, 100, 'E-commerce platform (Canada)');

-- Cryptocurrencies (20)
INSERT INTO public.investment_assets (symbol, name, "assetType", currency, "apiSource", "apiSymbol", "isActive", "minInvestment", description) VALUES
('BTC', 'Bitcoin', 'crypto', 'USD', 'twelvedata', 'BTC/USD', true, 100, 'Original cryptocurrency'),
('ETH', 'Ethereum', 'crypto', 'USD', 'twelvedata', 'ETH/USD', true, 100, 'Smart contract platform'),
('BNB', 'Binance Coin', 'crypto', 'USD', 'twelvedata', 'BNB/USD', true, 100, 'Binance exchange token'),
('SOL', 'Solana', 'crypto', 'USD', 'twelvedata', 'SOL/USD', true, 100, 'High-performance blockchain'),
('XRP', 'Ripple', 'crypto', 'USD', 'twelvedata', 'XRP/USD', true, 100, 'Payment settlement system'),
('ADA', 'Cardano', 'crypto', 'USD', 'twelvedata', 'ADA/USD', true, 100, 'Proof-of-stake blockchain'),
('DOGE', 'Dogecoin', 'crypto', 'USD', 'twelvedata', 'DOGE/USD', true, 100, 'Meme cryptocurrency'),
('AVAX', 'Avalanche', 'crypto', 'USD', 'twelvedata', 'AVAX/USD', true, 100, 'Smart contracts platform'),
('DOT', 'Polkadot', 'crypto', 'USD', 'twelvedata', 'DOT/USD', true, 100, 'Multi-chain protocol'),
('MATIC', 'Polygon', 'crypto', 'USD', 'twelvedata', 'MATIC/USD', true, 100, 'Ethereum scaling solution'),
('LINK', 'Chainlink', 'crypto', 'USD', 'twelvedata', 'LINK/USD', true, 100, 'Decentralized oracle network'),
('UNI', 'Uniswap', 'crypto', 'USD', 'twelvedata', 'UNI/USD', true, 100, 'Decentralized exchange'),
('LTC', 'Litecoin', 'crypto', 'USD', 'twelvedata', 'LTC/USD', true, 100, 'Peer-to-peer cryptocurrency'),
('ATOM', 'Cosmos', 'crypto', 'USD', 'twelvedata', 'ATOM/USD', true, 100, 'Blockchain interoperability'),
('XLM', 'Stellar', 'crypto', 'USD', 'twelvedata', 'XLM/USD', true, 100, 'Cross-border payments'),
('ALGO', 'Algorand', 'crypto', 'USD', 'twelvedata', 'ALGO/USD', true, 100, 'Proof-of-stake blockchain'),
('VET', 'VeChain', 'crypto', 'USD', 'twelvedata', 'VET/USD', true, 100, 'Supply chain blockchain'),
('ICP', 'Internet Computer', 'crypto', 'USD', 'twelvedata', 'ICP/USD', true, 100, 'Decentralized internet'),
('FIL', 'Filecoin', 'crypto', 'USD', 'twelvedata', 'FIL/USD', true, 100, 'Decentralized storage'),
('AAVE', 'Aave', 'crypto', 'USD', 'twelvedata', 'AAVE/USD', true, 100, 'DeFi lending protocol');
