import { useState, createContext, useContext } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Hero from './components/Hero';
import Sections from './components/Sections';
import Footer from './components/Footer';

// Sound URLs
export const SOUNDS = {
  addPoint: 'https://supabase.com/dashboard/project/vtbqbhuywdhnvitbcsfy/storage/files/buckets/source?path=sound&preview=add-point.mp3',
  error: 'https://supabase.com/dashboard/project/vtbqbhuywdhnvitbcsfy/storage/files/buckets/source?path=sound&preview=erorr.mp3',
  success: 'https://supabase.com/dashboard/project/vtbqbhuywdhnvitbcsfy/storage/files/buckets/source?path=sound&preview=success.mp3',
  upLevel: 'https://supabase.com/dashboard/project/vtbqbhuywdhnvitbcsfy/storage/files/buckets/source?path=sound&preview=uplevel.mp3',
  purchase: 'https://supabase.com/dashboard/project/vtbqbhuywdhnvitbcsfy/storage/files/buckets/source?path=sound&preview=purchase.mp3',
  notification: 'https://supabase.com/dashboard/project/vtbqbhuywdhnvitbcsfy/storage/files/buckets/source?path=sound&preview=notefcation.mp3',
};

// TMDB API
export const TMDB_API_KEY = 'dec98ec9b59a5938a5ee3ae4eda1e090';
export const TMDB_BASE = 'https://api.themoviedb.org/3';
export const TMDB_IMG = 'https://image.tmdb.org/t/p/original';
export const TMDB_IMG_W500 = 'https://image.tmdb.org/t/p/w500';

// App Context
interface AppState {
  isLoggedIn: boolean;
  user: any;
  points: number;
  level: number;
  sidebarOpen: boolean;
  notifications: any[];
  toastMessage: string;
  toastVisible: boolean;
}

interface AppContextType extends AppState {
  setSidebarOpen: (open: boolean) => void;
  playSound: (sound: string) => void;
  showToast: (message: string) => void;
  addPoints: (amount: number) => void;
  removePoints: (amount: number) => void;
}

export const AppContext = createContext<AppContextType>({} as AppContextType);
export const useApp = () => useContext(AppContext);

export function playSound(url: string) {
  try {
    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (e) {
    console.log('Sound play failed');
  }
}

function App() {
  const [state, setState] = useState<AppState>({
    isLoggedIn: false,
    user: null,
    points: 0,
    level: 1,
    sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
    notifications: [],
    toastMessage: '',
    toastVisible: false,
  });

  const setSidebarOpen = (open: boolean) => {
    setState(prev => ({ ...prev, sidebarOpen: open }));
  };

  const showToast = (message: string) => {
    setState(prev => ({ ...prev, toastMessage: message, toastVisible: true }));
    setTimeout(() => {
      setState(prev => ({ ...prev, toastVisible: false }));
    }, 4000);
  };

  const addPoints = (amount: number) => {
    setState(prev => ({
      ...prev,
      points: prev.points + amount,
    }));
    playSound(SOUNDS.addPoint);
    showToast(`+${amount} points added to your account!`);
  };

  const removePoints = (amount: number) => {
    setState(prev => ({
      ...prev,
      points: Math.max(0, prev.points - amount),
    }));
    playSound(SOUNDS.purchase);
  };

  const contextValue: AppContextType = {
    ...state,
    setSidebarOpen,
    playSound,
    showToast,
    addPoints,
    removePoints,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen bg-[#f0f2f5]">
        {/* Toast Notification */}
        {state.toastVisible && (
          <div className="toast-notification">
            <div className="bg-[#1877f2] text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">{state.toastMessage}</span>
            </div>
          </div>
        )}

        {/* Header */}
        <Header />

        {/* Main Layout */}
        <div className="flex pt-[56px]">
          {/* Sidebar */}
          <Sidebar />

          {/* Main Content */}
          <main className={`flex-1 transition-all duration-300 ${state.sidebarOpen ? 'lg:ml-[280px]' : 'ml-0'}`}>
            <Hero />
            <Sections />
            <Footer />
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}

export default App;
