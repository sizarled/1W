import { useState, useEffect } from 'react';
import { TMDB_API_KEY, TMDB_BASE, TMDB_IMG_W500 } from '../App';

interface Movie {
  id: number;
  title?: string;
  name?: string;
  backdrop_path: string;
  poster_path: string;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
}

// ============ FEATURES SECTION ============
const Features = () => {
  const features = [
    { icon: '🎬', title: 'Latest Movies', desc: 'Watch the latest movies from around the world in HD quality' },
    { icon: '📺', title: 'TV Series', desc: 'Follow your favorite series with new episodes every week' },
    { icon: '📡', title: 'IPTV Channels', desc: 'Access thousands of live TV channels from all countries' },
    { icon: '💰', title: 'Earn Points', desc: 'Earn points by completing tasks and participating in activities' },
    { icon: '🏆', title: 'Win Prizes', desc: 'Compete and win amazing prizes with your accumulated points' },
    { icon: '📝', title: 'Write Articles', desc: 'Share your knowledge and write articles about movies and series' },
    { icon: '🎥', title: 'Upload Videos', desc: 'Upload and share your own video content with the community' },
    { icon: '🛒', title: 'Store & Market', desc: 'Buy and sell items in our integrated marketplace' },
  ];

  return (
    <section id="features" className="py-16 px-4 md:px-8 bg-white">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-2 text-[#1877f2]">Site Features</h2>
        <p className="text-center text-[#65676b] mb-10">Everything you need in one platform</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div key={i} className="card-hover bg-[#f0f2f5] rounded-xl p-6 text-center">
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-[#65676b]">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ============ SEARCH SECTION ============
const SearchSection = () => {
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.href = `search.html?q=${encodeURIComponent(query)}`;
    }
  };

  return (
    <section id="search" className="py-16 px-4 md:px-8 bg-[#f0f2f5]">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-2 text-[#050505]">Search</h2>
        <p className="text-[#65676b] mb-8">Find movies, series, articles and more</p>
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for movies, series, articles..."
            className="w-full px-6 py-4 pl-14 rounded-full border-2 border-[#ced0d4] focus:border-[#1877f2] focus:outline-none text-lg shadow-sm"
          />
          <svg className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-[#65676b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-[#1877f2] text-white rounded-full font-medium hover:bg-[#1565c0] transition-colors">
            Search
          </button>
        </form>
      </div>
    </section>
  );
};

// ============ MOVIE CARD ============
const MovieCard = ({ movie, type }: { movie: Movie; type: 'movie' | 'tv' }) => {
  return (
    <a
      href={type === 'movie' ? `watch.html?movie=${movie.id}` : `watch.html?tv=${movie.id}`}
      className="flex-shrink-0 w-[180px] md:w-[200px] card-hover group"
    >
      <div className="relative rounded-xl overflow-hidden aspect-[2/3] bg-[#e4e6eb]">
        <img
          src={movie.poster_path ? `${TMDB_IMG_W500}${movie.poster_path}` : ''}
          alt={movie.title || movie.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
          <div className="flex items-center gap-1">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
        <div className="absolute top-2 right-2 px-2 py-1 bg-yellow-500 text-black text-xs font-bold rounded">
          ⭐ {movie.vote_average?.toFixed(1)}
        </div>
      </div>
      <div className="mt-2 px-1">
        <h3 className="text-sm font-medium truncate">{movie.title || movie.name}</h3>
        <p className="text-xs text-[#65676b]">{movie.release_date || movie.first_air_date}</p>
      </div>
    </a>
  );
};

// ============ TRENDING MOVIES ============
const TrendingMovies = () => {
  const [movies, setMovies] = useState<Movie[]>([]);

  useEffect(() => {
    fetch(`${TMDB_BASE}/trending/movie/week?api_key=${TMDB_API_KEY}`)
      .then(res => res.json())
      .then(data => setMovies(data.results?.slice(0, 50) || []))
      .catch(err => console.error(err));
  }, []);

  return (
    <section id="movies" className="py-16 px-4 md:px-8 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <span className="text-[#1877f2]">🎬</span> Trending Movies
            </h2>
            <p className="text-[#65676b] text-sm mt-1">Most popular movies this week</p>
          </div>
          <a href="movies.html" className="text-[#1877f2] font-medium text-sm hover:underline">
            See All →
          </a>
        </div>
        <div className="horizontal-scroll">
          {movies.map(movie => (
            <MovieCard key={movie.id} movie={movie} type="movie" />
          ))}
          {movies.length === 0 && (
            <div className="flex gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex-shrink-0 w-[200px]">
                  <div className="aspect-[2/3] rounded-xl animate-shimmer"></div>
                  <div className="mt-2 h-4 w-3/4 rounded animate-shimmer"></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

// ============ IPTV SECTION ============
const IPTVSection = () => {
  const [freeChannels, setFreeChannels] = useState<any[]>([]);
  const [premiumChannels, setPremiumChannels] = useState<any[]>([]);

  useEffect(() => {
    // Simulated IPTV data (would come from database)
    const mockFree = [
      { id: 1, name: 'Al Jazeera', logo: '📺', category: 'News' },
      { id: 2, name: 'BBC World', logo: '📺', category: 'News' },
      { id: 3, name: 'CNN', logo: '📺', category: 'News' },
      { id: 4, name: 'France 24', logo: '📺', category: 'News' },
      { id: 5, name: 'Sky Sports', logo: '⚽', category: 'Sports' },
      { id: 6, name: 'MBC 1', logo: '📺', category: 'Entertainment' },
      { id: 7, name: 'Rotana Cinema', logo: '🎬', category: 'Movies' },
      { id: 8, name: 'National Geographic', logo: '🌍', category: 'Documentary' },
    ];
    const mockPremium = [
      { id: 101, name: 'beIN Sports HD', logo: '⚽', category: 'Sports' },
      { id: 102, name: 'OSN Movies', logo: '🎬', category: 'Movies' },
      { id: 103, name: 'HBO Max', logo: '🎬', category: 'Movies' },
      { id: 104, name: 'Showtime', logo: '📺', category: 'Entertainment' },
      { id: 105, name: 'Discovery HD', logo: '🌍', category: 'Documentary' },
      { id: 106, name: 'Star Movies', logo: '🎬', category: 'Movies' },
    ];
    setFreeChannels(mockFree);
    setPremiumChannels(mockPremium);
  }, []);

  return (
    <section id="iptv" className="py-16 px-4 md:px-8 bg-[#f0f2f5]">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <span className="text-[#1877f2]">📡</span> IPTV Channels
            </h2>
            <p className="text-[#65676b] text-sm mt-1">Watch live TV channels from around the world</p>
          </div>
          <a href="iptv.html" className="text-[#1877f2] font-medium text-sm hover:underline">
            See All →
          </a>
        </div>

        {/* Free Channels */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="badge-free text-white px-3 py-1 rounded-full text-xs font-bold">FREE</span>
            <span className="text-sm text-[#65676b]">Available for all members</span>
          </div>
          <div className="horizontal-scroll">
            {freeChannels.map(ch => (
              <a
                key={ch.id}
                href={`iptv.html?M3U=${ch.id}`}
                className="flex-shrink-0 w-[160px] card-hover bg-white rounded-xl p-4 text-center"
              >
                <div className="text-3xl mb-2">{ch.logo}</div>
                <h3 className="text-sm font-medium truncate">{ch.name}</h3>
                <p className="text-xs text-[#65676b]">{ch.category}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Premium Channels */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="badge-premium text-black px-3 py-1 rounded-full text-xs font-bold">⭐ PREMIUM</span>
            <span className="text-sm text-[#65676b]">Available for premium members only</span>
          </div>
          <div className="horizontal-scroll">
            {premiumChannels.map(ch => (
              <a
                key={ch.id}
                href={`iptv.html?M3U=${ch.id}`}
                className="flex-shrink-0 w-[160px] card-hover bg-white rounded-xl p-4 text-center border-2 border-[#f5a623]/30"
              >
                <div className="text-3xl mb-2">{ch.logo}</div>
                <h3 className="text-sm font-medium truncate">{ch.name}</h3>
                <p className="text-xs text-[#65676b]">{ch.category}</p>
                <span className="mt-2 inline-block text-[10px] bg-[#f5a623]/20 text-[#f5a623] px-2 py-0.5 rounded-full font-bold">PREMIUM</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

// ============ TRENDING SERIES ============
const TrendingSeries = () => {
  const [series, setSeries] = useState<Movie[]>([]);

  useEffect(() => {
    fetch(`${TMDB_BASE}/trending/tv/week?api_key=${TMDB_API_KEY}`)
      .then(res => res.json())
      .then(data => setSeries(data.results?.slice(0, 50) || []))
      .catch(err => console.error(err));
  }, []);

  return (
    <section id="series" className="py-16 px-4 md:px-8 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <span className="text-[#1877f2]">📺</span> Trending Series
            </h2>
            <p className="text-[#65676b] text-sm mt-1">Most popular series this week</p>
          </div>
          <a href="series.html" className="text-[#1877f2] font-medium text-sm hover:underline">
            See All →
          </a>
        </div>
        <div className="horizontal-scroll">
          {series.map(show => (
            <MovieCard key={show.id} movie={show} type="tv" />
          ))}
          {series.length === 0 && (
            <div className="flex gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex-shrink-0 w-[200px]">
                  <div className="aspect-[2/3] rounded-xl animate-shimmer"></div>
                  <div className="mt-2 h-4 w-3/4 rounded animate-shimmer"></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

// ============ MEMBERSHIP SECTION ============
const Membership = () => {
  const plans = [
    {
      name: 'Free',
      class: 'free',
      price: '$0',
      period: '/month',
      maxLevel: 'LV3',
      watchCodes: 5,
      features: [
        'Watch movies & series',
        'Free IPTV channels',
        'Watch with ads',
        '5 watch codes max',
        'Upgrade to LV3 max',
        'Basic support',
      ],
      color: '#42b72a',
    },
    {
      name: 'Silver',
      class: 'silver',
      price: '$5',
      period: '/3 months',
      maxLevel: 'LV5',
      watchCodes: 10,
      features: [
        'Watch movies & series',
        'Free + Premium IPTV',
        'No ads',
        '10 watch codes max',
        'Upgrade to LV5 max',
        'Priority support',
        'Exclusive content',
      ],
      color: '#9e9e9e',
    },
    {
      name: 'Gold',
      class: 'gold',
      price: '$10',
      period: '/3 months',
      maxLevel: 'LV7',
      watchCodes: 10,
      features: [
        'Watch movies & series',
        'Free + Premium IPTV',
        'No ads',
        '10 watch codes max',
        'Upgrade to LV7 max',
        'Priority support',
        'Exclusive content',
        'Early access',
        'Bonus points x2',
      ],
      color: '#f5a623',
    },
    {
      name: 'Diamond',
      class: 'diamond',
      price: '$15',
      period: '/3 months',
      maxLevel: 'LV10',
      watchCodes: 10,
      features: [
        'Watch movies & series',
        'Free + Premium IPTV',
        'No ads',
        '10 watch codes max',
        'Upgrade to LV10 max',
        'VIP support 24/7',
        'All exclusive content',
        'Early access',
        'Bonus points x3',
        'Special badge',
      ],
      color: '#7c4dff',
    },
  ];

  return (
    <section id="membership" className="py-16 px-4 md:px-8 bg-[#f0f2f5]">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-2 text-[#1877f2]">Membership Plans</h2>
        <p className="text-center text-[#65676b] mb-10">Choose the plan that suits you • 1$ = 100 Points</p>
        <div className="horizontal-scroll justify-start md:justify-center">
          {plans.map((plan) => (
            <div key={plan.name} className={`membership-card ${plan.class} flex-shrink-0 w-[280px] bg-white rounded-xl shadow-md p-6`}>
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold mb-1" style={{ color: plan.color }}>{plan.name}</h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-[#65676b] text-sm">{plan.period}</span>
                </div>
                <p className="text-xs text-[#65676b] mt-1">Max Level: {plan.maxLevel}</p>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="register.html"
                className="block text-center py-3 rounded-lg font-bold text-white transition-colors"
                style={{ backgroundColor: plan.color }}
              >
                Register Free
              </a>
              <p className="text-center text-xs text-[#65676b] mt-2">
                Then upgrade from <a href="activate.html" className="underline">activate.html</a>
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ============ APPS SECTION ============
const Apps = () => {
  const apps = [
    { name: 'Windows', icon: '🪟', available: false },
    { name: 'macOS', icon: '🍎', available: false },
    { name: 'Linux', icon: '🐧', available: false },
    { name: 'Android', icon: '🤖', available: false },
    { name: 'iOS', icon: '📱', available: false },
    { name: 'Android TV', icon: '📺', available: false },
    { name: 'Apple TV', icon: '🍏', available: false },
  ];

  return (
    <section id="apps" className="py-16 px-4 md:px-8 bg-white">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-2 text-[#1877f2]">Download Our Apps</h2>
        <p className="text-center text-[#65676b] mb-10">Available on all your favorite platforms</p>
        <div className="horizontal-scroll justify-center">
          {apps.map((app) => (
            <div key={app.name} className="app-card flex-shrink-0 w-[150px] bg-[#f0f2f5] rounded-xl p-6 text-center relative">
              <div className="text-4xl mb-3">{app.icon}</div>
              <h3 className="font-medium text-sm">{app.name}</h3>
              {!app.available && (
                <span className="mt-2 inline-block text-[10px] bg-[#1877f2]/10 text-[#1877f2] px-2 py-1 rounded-full font-bold">
                  Coming Soon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ============ SUPPORT SECTION ============
const Support = () => {
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Message sent successfully!');
    setFormData({ name: '', email: '', message: '' });
  };

  return (
    <section id="support" className="py-16 px-4 md:px-8 bg-[#f0f2f5]">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-2 text-[#1877f2]">Contact Support</h2>
        <p className="text-center text-[#65676b] mb-10">We're here to help you</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Contact Form */}
          <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 shadow-sm">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-3 rounded-lg border border-[#ced0d4] focus:border-[#1877f2] focus:outline-none"
                  placeholder="Your full name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="w-full px-4 py-3 rounded-lg border border-[#ced0d4] focus:border-[#1877f2] focus:outline-none"
                  placeholder="your@email.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Message</label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({...formData, message: e.target.value})}
                  className="w-full px-4 py-3 rounded-lg border border-[#ced0d4] focus:border-[#1877f2] focus:outline-none h-32 resize-none"
                  placeholder="How can we help you?"
                  required
                />
              </div>
              <button type="submit" className="w-full py-3 bg-[#1877f2] text-white font-bold rounded-lg hover:bg-[#1565c0] transition-colors">
                Send Message
              </button>
            </div>
          </form>

          {/* Quick Links */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-lg mb-4">Quick Links</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'About Us', href: 'about.html', icon: 'ℹ️' },
                { label: 'Privacy Policy', href: 'previcy.html', icon: '🔒' },
                { label: 'Terms of Use', href: 'terms.html', icon: '📋' },
                { label: 'FAQ', href: 'help.html', icon: '❓' },
                { label: 'Contact', href: 'contact.html', icon: '📧' },
                { label: 'Help Center', href: 'help.html', icon: '💡' },
              ].map(link => (
                <a key={link.label} href={link.href} className="flex items-center gap-2 p-3 rounded-lg hover:bg-[#f0f2f2] transition-colors border border-[#f0f2f5]">
                  <span>{link.icon}</span>
                  <span className="text-sm font-medium">{link.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ============ PLATFORM SECTION ============
const Platform = () => {
  const platforms = [
    { name: 'YouTube', url: 'https://www.youtube.com/@CineauraV2', icon: '▶️', color: '#FF0000' },
    { name: 'Facebook', url: 'https://www.facebook.com/CineauraV2', icon: '👥', color: '#1877F2' },
    { name: 'Facebook Group', url: 'https://web.facebook.com/groups/2011674376679254', icon: '👨‍👩‍👧‍👦', color: '#1877F2' },
    { name: 'Instagram', url: 'https://www.instagram.com/cineaurav2/', icon: '📷', color: '#E4405F' },
    { name: 'Reddit', url: 'https://www.reddit.com/r/Cineaura2', icon: '🤖', color: '#FF4500' },
    { name: 'Pinterest', url: 'https://www.pinterest.com/CineauraV2', icon: '📌', color: '#E60023' },
    { name: 'Quora', url: 'https://msaht-cineaurav2arabic.quora.com', icon: '❓', color: '#B92B27' },
    { name: 'Tumblr', url: 'https://www.tumblr.com/cineaura-officiel-v2', icon: '📝', color: '#35465C' },
    { name: 'Rumble', url: 'https://rumble.com/c/c-7972430', icon: '📹', color: '#85C742' },
    { name: 'Odysee', url: 'https://odysee.com/@CineauraV2:c10d9b2863', icon: '🎥', color: '#2F9176' },
    { name: 'Vimeo', url: 'https://vimeo.com/channels/1972980', icon: '🎬', color: '#1AB7EA' },
    { name: 'TikTok', url: 'https://www.tiktok.com/@cineauraV2', icon: '🎵', color: '#000000' },
    { name: 'Bilibili', url: 'https://www.bilibili.tv/en/space/1861102337', icon: '📺', color: '#FB7299' },
    { name: 'Telegram', url: 'https://t.me/CineauraV2', icon: '✈️', color: '#0088CC' },
  ];

  return (
    <section className="py-16 px-4 md:px-8 bg-white">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-2 text-[#1877f2]">Follow Us</h2>
        <p className="text-center text-[#65676b] mb-10">Stay connected on all platforms</p>
        <div className="horizontal-scroll justify-center">
          {platforms.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="app-card flex-shrink-0 w-[130px] bg-[#f0f2f5] rounded-xl p-4 text-center hover:shadow-lg"
            >
              <div className="text-3xl mb-2">{p.icon}</div>
              <h3 className="text-xs font-medium truncate">{p.name}</h3>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

// ============ MAIN SECTIONS COMPONENT ============
const Sections = () => {
  return (
    <>
      <Features />
      <SearchSection />
      <TrendingMovies />
      <IPTVSection />
      <TrendingSeries />
      <Membership />
      <Apps />
      <Support />
      <Platform />
    </>
  );
};

export default Sections;
