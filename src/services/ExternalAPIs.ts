/**
 * EXTERNAL APIs SERVICE
 * Handles connections to free external APIs:
 * - News (RSS feeds)
 * - Stocks (Yahoo Finance)
 * - Sports (free APIs)
 * - Traffic (if Google Maps API configured)
 */

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  pubDate: string;
  description?: string;
  imageUrl?: string;      // Real image from the article
  thumbnailUrl?: string;  // Smaller version
  author?: string;
  category?: string;
}

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  name?: string;
}

export interface SportsScore {
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  startTime?: string;
}

export interface TrafficInfo {
  destination: string;
  duration: string;
  durationInTraffic: string;
  distance: string;
  summary: string;
}

// RSS Feed URLs for news
const NEWS_FEEDS = {
  general: 'https://feeds.bbci.co.uk/news/rss.xml',
  tech: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
  science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
};

// Multiple CORS proxies for fallback
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

export class ExternalAPIsService {
  private googleMapsKey?: string;
  private newsApiKey?: string;

  constructor(config?: { googleMapsKey?: string; newsApiKey?: string }) {
    this.googleMapsKey = config?.googleMapsKey;
    this.newsApiKey = config?.newsApiKey;
  }

  // ===========================================================================
  // NEWS
  // ===========================================================================

  /**
   * Fetch with multiple proxy fallbacks
   */
  private async fetchWithProxies(url: string): Promise<string | null> {
    for (const proxyFn of CORS_PROXIES) {
      try {
        const proxyUrl = proxyFn(url);
        console.log(`[News] Trying proxy: ${proxyUrl.substring(0, 50)}...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(proxyUrl, { 
          signal: controller.signal,
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          }
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const text = await response.text();
          if (text && text.includes('<item>')) {
            console.log('[News] Successfully fetched via proxy');
            return text;
          }
        }
      } catch (error) {
        console.warn(`[News] Proxy failed:`, error);
        continue;
      }
    }
    return null;
  }

  /**
   * Fetch news headlines from RSS feeds
   * Uses multiple CORS proxies with fallback
   */
  async getNews(category: keyof typeof NEWS_FEEDS = 'general', count: number = 5): Promise<NewsItem[]> {
    try {
      const feedUrl = NEWS_FEEDS[category] || NEWS_FEEDS.general;
      console.log(`[News] Fetching ${category} news from ${feedUrl}`);
      
      const xmlText = await this.fetchWithProxies(feedUrl);
      
      if (!xmlText) {
        console.error('[News] All proxies failed');
        return this.getFallbackNews(category);
      }
      
      // Parse XML
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'text/xml');
      
      // Check for parse errors
      const parseError = xml.querySelector('parsererror');
      if (parseError) {
        console.error('[News] XML parse error');
        return this.getFallbackNews(category);
      }
      
      const items = xml.querySelectorAll('item');
      
      if (items.length === 0) {
        console.warn('[News] No items found in RSS feed');
        return this.getFallbackNews(category);
      }
      
      const news: NewsItem[] = [];
      for (let i = 0; i < Math.min(items.length, count); i++) {
        const item = items[i];
        
        // Extract image from various possible sources
        let imageUrl: string | undefined;
        
        // Try media:thumbnail (BBC uses this)
        const mediaThumbnail = item.querySelector('thumbnail');
        if (mediaThumbnail) {
          imageUrl = mediaThumbnail.getAttribute('url') || undefined;
        }
        
        // Try media:content
        if (!imageUrl) {
          const mediaContent = item.querySelector('content');
          if (mediaContent && mediaContent.getAttribute('medium') === 'image') {
            imageUrl = mediaContent.getAttribute('url') || undefined;
          }
        }
        
        // Try enclosure (common RSS image tag)
        if (!imageUrl) {
          const enclosure = item.querySelector('enclosure');
          if (enclosure && enclosure.getAttribute('type')?.startsWith('image')) {
            imageUrl = enclosure.getAttribute('url') || undefined;
          }
        }
        
        // Try to extract image from description HTML
        if (!imageUrl) {
          const desc = item.querySelector('description')?.textContent || '';
          const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/);
          if (imgMatch) {
            imageUrl = imgMatch[1];
          }
        }
        
        // Get the actual source name from the feed
        const sourceElement = item.querySelector('source');
        const sourceName = sourceElement?.textContent || 
                          xml.querySelector('channel > title')?.textContent || 
                          'BBC News';
        
        news.push({
          title: item.querySelector('title')?.textContent || 'No title',
          source: sourceName,
          link: item.querySelector('link')?.textContent || '',
          pubDate: item.querySelector('pubDate')?.textContent || '',
          description: item.querySelector('description')?.textContent || '',
          imageUrl: imageUrl,
          author: item.querySelector('author')?.textContent || 
                  item.querySelector('creator')?.textContent || undefined,
          category: item.querySelector('category')?.textContent || category,
        });
      }
      
      console.log(`[News] Successfully parsed ${news.length} items`);
      return news;
    } catch (error) {
      console.error('[News] Failed to fetch news:', error);
      return this.getFallbackNews(category);
    }
  }

  /**
   * Fallback news when RSS fails
   */
  private getFallbackNews(category: string): NewsItem[] {
    // Return a message indicating news is temporarily unavailable
    return [{
      title: `${category.charAt(0).toUpperCase() + category.slice(1)} news temporarily unavailable`,
      source: 'JARVIS',
      link: '',
      pubDate: new Date().toISOString(),
      description: 'Unable to fetch live news at the moment. Please try again later.',
    }];
  }

  /**
   * Format news for speech
   */
  formatNewsForSpeech(news: NewsItem[]): string {
    if (news.length === 0) {
      return "I couldn't retrieve the latest news at the moment.";
    }

    const headlines = news.slice(0, 5).map((item, i) => {
      const prefix = i === 0 ? 'Top story:' : 
                     i === 1 ? 'Second:' :
                     i === 2 ? 'Third:' :
                     i === 3 ? 'Fourth:' : 'And finally:';
      // Include source for context
      return `${prefix} From ${item.source}: ${item.title}`;
    });

    return `Here are today's headlines. ${headlines.join('. ')}.`;
  }

  // ===========================================================================
  // STOCKS
  // ===========================================================================

  /**
   * Get stock quote using Yahoo Finance (via proxy)
   */
  async getStockQuote(symbol: string): Promise<StockQuote | null> {
    try {
      // Use Yahoo Finance API via a proxy
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      
      const response = await fetch(proxyUrl);
      const data = await response.json();
      
      const quote = data.chart?.result?.[0];
      if (!quote) return null;

      const meta = quote.meta;
      const price = meta.regularMarketPrice;
      const previousClose = meta.previousClose || meta.chartPreviousClose;
      const change = price - previousClose;
      const changePercent = (change / previousClose) * 100;

      return {
        symbol: symbol.toUpperCase(),
        price: Math.round(price * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        name: meta.shortName || meta.symbol,
      };
    } catch (error) {
      console.error('[Stocks] Failed to fetch quote:', error);
      return null;
    }
  }

  /**
   * Get multiple stock quotes
   */
  async getPortfolio(symbols: string[]): Promise<StockQuote[]> {
    const quotes = await Promise.all(symbols.map(s => this.getStockQuote(s)));
    return quotes.filter((q): q is StockQuote => q !== null);
  }

  /**
   * Format stock for speech
   */
  formatStockForSpeech(quote: StockQuote): string {
    const direction = quote.change >= 0 ? 'up' : 'down';
    const absChange = Math.abs(quote.change);
    const absPercent = Math.abs(quote.changePercent);
    
    return `${quote.name || quote.symbol} is trading at $${quote.price}, ${direction} $${absChange} or ${absPercent}%.`;
  }

  // ===========================================================================
  // SPORTS
  // ===========================================================================

  /**
   * Get sports scores - using a free API
   * Note: Many free sports APIs have limitations
   */
  async getSportsScores(league: string = 'nfl'): Promise<SportsScore[]> {
    try {
      // ESPN has a hidden API we can use
      const leagueMap: Record<string, string> = {
        'nfl': 'football/nfl',
        'nba': 'basketball/nba',
        'mlb': 'baseball/mlb',
        'nhl': 'hockey/nhl',
        'soccer': 'soccer/eng.1', // Premier League
        'premier league': 'soccer/eng.1',
      };

      const espnLeague = leagueMap[league.toLowerCase()] || leagueMap['nfl'];
      const url = `https://site.api.espn.com/apis/site/v2/sports/${espnLeague}/scoreboard`;
      
      const response = await fetch(url);
      const data = await response.json();

      const scores: SportsScore[] = [];
      for (const event of data.events || []) {
        const competition = event.competitions?.[0];
        if (!competition) continue;

        const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');

        if (homeTeam && awayTeam) {
          scores.push({
            league: league.toUpperCase(),
            homeTeam: homeTeam.team?.shortDisplayName || homeTeam.team?.name || 'Home',
            awayTeam: awayTeam.team?.shortDisplayName || awayTeam.team?.name || 'Away',
            homeScore: parseInt(homeTeam.score) || 0,
            awayScore: parseInt(awayTeam.score) || 0,
            status: event.status?.type?.description || 'Unknown',
            startTime: event.date,
          });
        }
      }

      return scores;
    } catch (error) {
      console.error('[Sports] Failed to fetch scores:', error);
      return [];
    }
  }

  /**
   * Format sports scores for speech
   */
  formatSportsForSpeech(scores: SportsScore[]): string {
    if (scores.length === 0) {
      return "No games to report at the moment.";
    }

    const gameStrings = scores.slice(0, 3).map(game => {
      if (game.status.toLowerCase().includes('final')) {
        const winner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
        const loser = game.homeScore > game.awayScore ? game.awayTeam : game.homeTeam;
        const winScore = Math.max(game.homeScore, game.awayScore);
        const loseScore = Math.min(game.homeScore, game.awayScore);
        return `${winner} defeated ${loser}, ${winScore} to ${loseScore}`;
      } else if (game.status.toLowerCase().includes('progress') || game.status.toLowerCase().includes('half')) {
        return `${game.awayTeam} at ${game.homeTeam}, currently ${game.awayScore} to ${game.homeScore}`;
      } else {
        return `${game.awayTeam} at ${game.homeTeam}, scheduled`;
      }
    });

    return `${scores[0].league} scores: ${gameStrings.join('. ')}.`;
  }

  // ===========================================================================
  // TRAFFIC
  // ===========================================================================

  /**
   * Get traffic/directions info
   * Requires Google Maps API key
   */
  async getTraffic(origin: string, destination: string): Promise<TrafficInfo | null> {
    if (!this.googleMapsKey) {
      return null;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&departure_time=now&key=${this.googleMapsKey}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== 'OK' || !data.routes?.[0]) {
        return null;
      }

      const route = data.routes[0];
      const leg = route.legs[0];

      return {
        destination: leg.end_address,
        duration: leg.duration.text,
        durationInTraffic: leg.duration_in_traffic?.text || leg.duration.text,
        distance: leg.distance.text,
        summary: route.summary,
      };
    } catch (error) {
      console.error('[Traffic] Failed to fetch directions:', error);
      return null;
    }
  }

  /**
   * Format traffic for speech
   */
  formatTrafficForSpeech(traffic: TrafficInfo): string {
    return `The commute to ${traffic.destination} is currently ${traffic.durationInTraffic} via ${traffic.summary}, covering ${traffic.distance}.`;
  }

  // ===========================================================================
  // CRYPTO
  // ===========================================================================

  /**
   * Get cryptocurrency price
   */
  async getCryptoPrice(symbol: string): Promise<StockQuote | null> {
    try {
      // CoinGecko free API
      const coinMap: Record<string, string> = {
        'btc': 'bitcoin',
        'bitcoin': 'bitcoin',
        'eth': 'ethereum',
        'ethereum': 'ethereum',
        'doge': 'dogecoin',
        'dogecoin': 'dogecoin',
        'sol': 'solana',
        'solana': 'solana',
      };

      const coinId = coinMap[symbol.toLowerCase()] || symbol.toLowerCase();
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
      
      const response = await fetch(url);
      const data = await response.json();

      const coinData = data[coinId];
      if (!coinData) return null;

      return {
        symbol: symbol.toUpperCase(),
        price: Math.round(coinData.usd * 100) / 100,
        change: 0, // CoinGecko doesn't give absolute change in this endpoint
        changePercent: Math.round(coinData.usd_24h_change * 100) / 100,
        name: coinId.charAt(0).toUpperCase() + coinId.slice(1),
      };
    } catch (error) {
      console.error('[Crypto] Failed to fetch price:', error);
      return null;
    }
  }
}
