/**
 * Twelve Data API Client
 * Free tier: 800 calls/day, 8 calls/minute
 * Supports stocks and crypto
 * Docs: https://twelvedata.com/docs
 */

interface TwelveDataPriceResponse {
	symbol: string;
	price: string;
	timestamp: number;
}

interface TwelveDataQuoteResponse {
	symbol: string;
	name: string;
	exchange: string;
	currency: string;
	datetime: string;
	timestamp: number;
	open: string;
	high: string;
	low: string;
	close: string;
	volume: string;
	previous_close: string;
	change: string;
	percent_change: string;
	average_volume: string;
	fifty_two_week: {
		low: string;
		high: string;
		low_change: string;
		high_change: string;
		low_change_percent: string;
		high_change_percent: string;
		range: string;
	};
}

interface TwelveDataErrorResponse {
	code: 400 | 401 | 403 | 404 | 414 | 429 | 500;
	message: string;
	status: "error";
}

export interface AssetPrice {
	symbol: string;
	price: number; // In cents (multiply by 100)
	previousClose?: number; // In cents
	change24h?: number; // In cents
	changePercent24h?: number; // As basis points (525 = 5.25%)
	volume24h?: string;
	timestamp: Date;
}

export class TwelveDataClient {
	private apiKey: string;
	private baseUrl = "https://api.twelvedata.com";
	private callCount = 0;
	private lastResetTime = Date.now();
	private readonly MAX_CALLS_PER_DAY = 800;
	private readonly MAX_CALLS_PER_MINUTE = 8;
	private callsThisMinute = 0;
	private minuteResetTime = Date.now();

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	/**
	 * Reset counters if needed
	 */
	private resetCountersIfNeeded() {
		const now = Date.now();

		// Reset daily counter
		if (now - this.lastResetTime > 24 * 60 * 60 * 1000) {
			this.callCount = 0;
			this.lastResetTime = now;
		}

		// Reset minute counter
		if (now - this.minuteResetTime > 60 * 1000) {
			this.callsThisMinute = 0;
			this.minuteResetTime = now;
		}
	}

	/**
	 * Check if we can make an API call
	 */
	private canMakeCall(): boolean {
		this.resetCountersIfNeeded();

		if (this.callCount >= this.MAX_CALLS_PER_DAY) {
			console.warn(`[TwelveData] Daily limit reached: ${this.callCount}/${this.MAX_CALLS_PER_DAY}`);
			return false;
		}

		if (this.callsThisMinute >= this.MAX_CALLS_PER_MINUTE) {
			console.warn(
				`[TwelveData] Per-minute limit reached: ${this.callsThisMinute}/${this.MAX_CALLS_PER_MINUTE}`,
			);
			return false;
		}

		return true;
	}

	/**
	 * Track an API call
	 */
	private trackCall() {
		this.callCount++;
		this.callsThisMinute++;
	}

	/**
	 * Get current usage stats
	 */
	public getUsageStats() {
		this.resetCountersIfNeeded();
		return {
			dailyCalls: this.callCount,
			dailyLimit: this.MAX_CALLS_PER_DAY,
			dailyRemaining: this.MAX_CALLS_PER_DAY - this.callCount,
			callsThisMinute: this.callsThisMinute,
			minuteLimit: this.MAX_CALLS_PER_MINUTE,
		};
	}

	/**
	 * Make a fetch request with proper authentication and error handling
	 */
	private async makeRequest<T>(
		endpoint: string,
		params: Record<string, string>,
		retries = 0,
	): Promise<T | TwelveDataErrorResponse> {
		const url = new URL(`${this.baseUrl}${endpoint}`);

		// Add query parameters
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}

		// Use HTTP header authentication (recommended by docs)
		const headers = new Headers({
			Authorization: `apikey ${this.apiKey}`,
		});

		const response = await fetch(url.toString(), { headers });
		const data = (await response.json()) as T | TwelveDataErrorResponse;

		// Handle specific error codes
		if ("status" in data && data.status === "error") {
			const errorData = data as TwelveDataErrorResponse;

			// Handle 429 (Too Many Requests) with retry logic
			if (errorData.code === 429 && retries < 3) {
				const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff: 1s, 2s, 4s
				console.warn(`[TwelveData] Rate limit hit (429). Retrying in ${waitTime}ms...`);
				await new Promise((resolve) => setTimeout(resolve, waitTime));
				return this.makeRequest<T>(endpoint, params, retries + 1);
			}

			// Handle other errors
			switch (errorData.code) {
				case 401:
					console.error("[TwelveData] Invalid API key (401)");
					break;
				case 403:
					console.error("[TwelveData] Insufficient permissions (403). Upgrade required.");
					break;
				case 404:
					console.error("[TwelveData] Resource not found (404)");
					break;
				case 500:
					console.error("[TwelveData] Server error (500). Please retry later.");
					break;
				default:
					console.error(`[TwelveData] Error ${errorData.code}: ${errorData.message}`);
			}

			return errorData;
		}

		return data as T;
	}

	/**
	 * Fetch price for a single asset
	 */
	async getPrice(symbol: string): Promise<AssetPrice | null> {
		if (!this.canMakeCall()) {
			throw new Error("API rate limit exceeded");
		}

		try {
			const data = await this.makeRequest<TwelveDataPriceResponse>("/price", { symbol });

			this.trackCall();

			// Check if it's an error response
			if ("status" in data && data.status === "error") {
				console.error(`[TwelveData] Error fetching price for ${symbol}:`, data.message);
				return null;
			}

			const priceData = data as TwelveDataPriceResponse;
			const priceInCents = Math.floor(parseFloat(priceData.price) * 100);

			return {
				symbol: priceData.symbol,
				price: priceInCents,
				timestamp: new Date(priceData.timestamp * 1000),
			};
		} catch (error) {
			console.error(`[TwelveData] Failed to fetch price for ${symbol}:`, error);
			return null;
		}
	}

	/**
	 * Fetch detailed quote for a single asset
	 */
	async getQuote(symbol: string): Promise<AssetPrice | null> {
		if (!this.canMakeCall()) {
			throw new Error("API rate limit exceeded");
		}

		try {
			const data = await this.makeRequest<TwelveDataQuoteResponse>("/quote", { symbol });

			this.trackCall();

			// Check if it's an error response
			if ("status" in data && data.status === "error") {
				console.error(`[TwelveData] Error fetching quote for ${symbol}:`, data.message);
				return null;
			}

			const quote = data as TwelveDataQuoteResponse;

			// Parse values (handle potential null values as per docs)
			const price = Math.floor(parseFloat(quote.close || "0") * 100);
			const previousClose = quote.previous_close ? Math.floor(parseFloat(quote.previous_close) * 100) : null;
			const change = quote.change ? Math.floor(parseFloat(quote.change) * 100) : null;
			const changePercent = quote.percent_change ? Math.floor(parseFloat(quote.percent_change) * 100) : null;

			return {
				symbol: quote.symbol,
				price,
				previousClose: previousClose || undefined,
				change24h: change || undefined,
				changePercent24h: changePercent || undefined,
				volume24h: quote.volume || undefined,
				timestamp: new Date(quote.timestamp * 1000),
			};
		} catch (error) {
			console.error(`[TwelveData] Failed to fetch quote for ${symbol}:`, error);
			return null;
		}
	}

	/**
	 * Fetch prices for multiple assets (makes individual calls)
	 * Note: Twelve Data doesn't have a true batch endpoint on free tier
	 */
	async getPrices(symbols: string[]): Promise<Map<string, AssetPrice>> {
		const results = new Map<string, AssetPrice>();

		// Process in batches to respect rate limits
		const BATCH_SIZE = 8; // Match per-minute limit

		for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
			const batch = symbols.slice(i, i + BATCH_SIZE);

			// Fetch all in parallel
			const promises = batch.map((symbol) => this.getQuote(symbol));
			const prices = await Promise.all(promises);

			// Add to results
			for (const price of prices) {
				if (price) {
					results.set(price.symbol, price);
				}
			}

			// If there are more batches, wait 1 minute to avoid rate limit
			if (i + BATCH_SIZE < symbols.length) {
				console.log(`[TwelveData] Waiting 60s before next batch...`);
				await new Promise((resolve) => setTimeout(resolve, 60000));
			}
		}

		return results;
	}
}

// Singleton instance
let clientInstance: TwelveDataClient | null = null;

export function getTwelveDataClient(): TwelveDataClient {
	if (!clientInstance) {
		const apiKey = process.env.TWELVEDATA_API_KEY;
		if (!apiKey) {
			throw new Error("TWELVEDATA_API_KEY environment variable is not set");
		}
		clientInstance = new TwelveDataClient(apiKey);
	}
	return clientInstance;
}
