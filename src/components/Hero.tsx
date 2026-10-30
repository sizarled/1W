import { useState, useEffect } from 'react';
import { TMDB_API_KEY, TMDB_BASE, TMDB_IMG } from '../App';

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
  genre_ids: number[];
}

const Hero = () => {
  const [trendingMovies, setTrendingMovies] = useState<Movie[]>([]);
  const [trendingTV, setTrendingTV] = useState<Movie[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [allSlides, setAllSlides] = useState<Movie[]>([]);

  useEffect(() => {
    fetchTrending();
  }, []);

  const fetchTrending = async () => {
    try {
      const [moviesRes, tvRes] = await Promise.all([
        fetch(`${TMDB_BASE}/trending/movie/week?api_key=${TMDB_API_KEY}`),
        fetch(`${TMDB_BASE}/trending/tv/week?api_key=${TMDB_API_KEY}`),
      ]);
      const moviesData = await moviesRes.json();
      const tvData = await tvRes.json();

      const topMovies = moviesData.results?.slice(0, 5) || [];
      const topTV = tvData.results?.slice(0, 5) || [];

      setTrendingMovies(topMovies);
      setTrendingTV(topTV);
      setAllSlides([...topMovies, ...topTV]);
    } catch (error) {
      console.error('Failed to fetch trending:', error);
    }
  };

  useEffect(() => {
    if (allSlides.length > 0) {
      const interval = setInterval(() => {
        setCurrentSlide(prev => (prev + 1) % allSlides.length);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [allSlides.length]);

  const current = allSlides[currentSlide];

  return (
    <section className="relative h-[500px] md:h-[600px] overflow-hidden bg-black">
      {/* Background Image */}
      {allSlides.map((slide, index) => (
        <div
          key={slide.id}
          className={`absolute inset-0 hero-slide ${index === currentSlide ? 'opacity-100' : 'opacity-0'}`}
        >
          <img
            src={`${TMDB_IMG}${slide.backdrop_path}`}
            alt={slide.title || slide.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 gradient-overlay"></div>
        </div>
      ))}

      {/* Content */}
      {current && (
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-16 z-10">
          <div className="max-w-2xl animate-fadeIn">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-1 bg-[#1877f2] text-white text-xs font-bold rounded">
                {current.title ? '🎬 MOVIE' : '📺 SERIES'}
              </span>
              <span className="px-2 py-1 bg-yellow-500 text-black text-xs font-bold rounded">
                ⭐ {current.vote_average?.toFixed(1)}
              </span>
              <span className="text-white/70 text-sm">
                {current.release_date || current.first_air_date}
              </span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold text-white mb-4">
              {current.title || current.name}
            </h1>
            <p className="text-white/80 text-sm md:text-base mb-6 line-clamp-3">
              {current.overview}
            </p>
            <div className="flex gap-3">
              <a
                href={current.title ? `watch.html?movie=${current.id}` : `watch.html?tv=${current.id}`}
                className="px-6 py-3 bg-[#1877f2] text-white font-bold rounded-lg hover:bg-[#1565c0] transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                Watch Now
              </a>
              <button className="px-6 py-3 bg-white/20 text-white font-bold rounded-lg hover:bg-white/30 transition-colors backdrop-blur-sm">
                + My List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide Indicators */}
      <div className="absolute bottom-4 right-8 flex gap-2 z-10">
        {allSlides.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentSlide(index)}
            className={`w-3 h-3 rounded-full transition-all ${
              index === currentSlide ? 'bg-[#1877f2] w-8' : 'bg-white/50'
            }`}
          />
        ))}
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={() => setCurrentSlide(prev => prev === 0 ? allSlides.length - 1 : prev - 1)}
        className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors z-10"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onClick={() => setCurrentSlide(prev => (prev + 1) % allSlides.length)}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors z-10"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </section>
  );
};

export default Hero;
